package com.authbackup.core

import java.time.Instant
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

/** What the vectors do not cover: file round trips, the storage format, and JS behavior checked against the JS core by hand. */
class CoreTests {
    private val keys = listOf(
        StoredAccount(id = "a", otp = OtpAccount(issuer = "Example", account = "alice", secret = "JBSWY3DPEHPK3PXP"), source = "qr", addedAt = "2026-11-25T12:00:00.000Z"),
        StoredAccount(
            id = "b", source = "manual", addedAt = "2026-11-26T08:30:00.000Z",
            otp = OtpAccount(type = OtpType.hotp, issuer = "Bank & Co", account = "zoë", secret = "MFRGGZDFMZTWQ2LK", algorithm = OtpAlgorithm.SHA512, digits = 8, counter = 42),
        ),
    )

    private fun key(e: CoreError?) = e?.key

    @Test
    fun encryptedFileRoundTrip() {
        val file = Backup.encryptedFile(keys, "correct horse", iterations = 1000, now = Instant.parse("2026-11-26T10:00:00.123Z"))
        val outer = Json.parseToJsonElement(file.decodeToString()).jsonObject
        assertEquals(listOf("app", "count", "encrypted", "exportedAt", "version"), outer.keys.toList())
        assertEquals("2026-11-26T10:00:00.123Z", (outer["exportedAt"] as JsonPrimitive).content)
        val content = Backup.read(file)
        assertTrue(content is Backup.Content.Encrypted)
        val vault = (content as Backup.Content.Encrypted).vault
        assertEquals(keys.map { it.otp }, Backup.restore(Backup.open(vault, "correct horse")))
        assertEquals("wrongPassword", key(assertThrows<CoreError> { Backup.open(vault, "correct horsf") }))
    }

    @Test
    fun plainFileAndLinks() {
        val content = Backup.read(Backup.plainFile(keys))
        assertEquals(keys.map { it.otp }, Backup.restore((content as Backup.Content.Entries).entries))
        val text = Backup.otpauthText(keys)
        assertEquals(keys.map { it.otp }, text.lines().filter { it.isNotEmpty() }.map(Otpauth::parse))
        assertEquals(Backup.Content.Links(text), Backup.read(text.encodeToByteArray()))
        // Blob.text() drops a byte order mark before JSON.parse.
        assertTrue(Backup.read(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "[]".encodeToByteArray()) is Backup.Content.Entries)
        assertEquals("notBackup", key(assertThrows<CoreError> { Backup.read("{\"a\":1}".encodeToByteArray()) }))
        assertEquals("notBackup", key(assertThrows<CoreError> { Backup.read("[1,]".encodeToByteArray()) }))
    }

    @Test
    fun storedAccountJson() {
        val json = Json
        val text = json.encodeToString(ListSerializer(StoredAccount.serializer()), keys)
        assertEquals(keys, json.decodeFromString(ListSerializer(StoredAccount.serializer()), text))
        val first = json.encodeToJsonElement(StoredAccount.serializer(), keys[0]).jsonObject
        // Flat, and every OTP field is written even with the default Json (encodeDefaults = false).
        assertEquals(
            setOf("type", "issuer", "account", "secret", "algorithm", "digits", "period", "counter", "id", "source", "addedAt"),
            first.keys,
        )
        assertEquals(JsonPrimitive("totp"), first["type"])
        assertEquals(JsonPrimitive(0), first["counter"])
        // Other members are ignored; a missing source or addedAt reads as the iOS app reads it.
        val loose = """{"id":"x","secret":"JBSWY3DP","type":"hotp","known":true}"""
        assertEquals(StoredAccount(id = "x", otp = OtpAccount(type = OtpType.hotp, secret = "JBSWY3DP"), source = "backup", addedAt = ""), json.decodeFromString(StoredAccount.serializer(), loose))
        assertThrows<SerializationException> { json.decodeFromString(StoredAccount.serializer(), """{"secret":"JBSWY3DP"}""") }
    }

    @Test
    fun pbkdf2WithoutSaltMatchesTheJdk() {
        // The empty-salt path is a hand-written PBKDF2; it must agree with the JDK where both work.
        for ((password, iterations) in listOf("password" to 1, "pässwörd-🔑" to 3, "" to 1000)) {
            val salt = "salt".encodeToByteArray()
            val jdk = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(PBEKeySpec(password.toCharArray(), salt, iterations, 256)).encoded
            assertArrayEquals(jdk, Backup.pbkdf2Block(password.encodeToByteArray(), salt, iterations))
        }
        assertEquals(32, Backup.deriveKey("pw", ByteArray(0), 10).encoded.size)
    }

    /** Outcomes of the JS core (Node 24) for inputs the vectors do not have, where a naive port would differ. */
    @Test
    fun jsEdgeCases() {
        val s = "JBSWY3DPEHPK3PXP"
        fun parse(uri: String) = try {
            Otpauth.parse(uri).toString()
        } catch (e: CoreError) {
            e.key
        }
        assertEquals("other", parse("otpauth://:443/x?secret=$s")) // a port without a host
        assertEquals("other", parse("otpauth://user@/x?secret=$s")) // user info without a host
        assertEquals("other", parse("otpauth://totp:0000065536/x?secret=$s")) // the port is checked in full
        assertEquals("errUnknownType", parse("otpauth://[::1]/x?secret=$s")) // an IPv6 host is a valid URL
        assertEquals("other", parse("otpauth://[1::2::3]/x?secret=$s"))
        // The issuer prefix is matched code unit by code unit: a decomposed "é" in the label is not the issuer's "é".
        assertEquals("é:me", Otpauth.parse("otpauth://totp/A:e%CC%81:me?secret=$s&issuer=A:%C3%A9").account)
        assertEquals("SHA1", Otpauth.parse("otpauth://totp/x?secret=$s&algorithm=%C5%BFha1").algorithm.name) // "ſ".toUpperCase() is "S"
        // /^otpauth-migration:/i folds ASCII letters only.
        assertEquals("errNotOtp", key(assertThrows<CoreError> { Otpauth.parseAny("otpauth-mİgration://offline?data=CgA%3D") }))
        // String(x) of JSON numbers in a backup entry's labels follows Number::toString.
        val r = Backup.restore(JS.parseJson("""{"secret":"$s","issuer":12345678901234567890,"account":0.00001}"""))
        assertEquals(listOf("12345678901234567000", "0.00001"), listOf(r.issuer, r.account))
        // A number the key uses is not coerced: String(1e21) is "1e+21", which parseInt read as a period of 1.
        assertEquals("errPeriod", key(assertThrows<CoreError> { Backup.restore(JS.parseJson("""{"secret":"$s","period":1e21}""")) }))
        assertEquals("σ", JS.lowercase("Σ"))
        assertEquals("aς", JS.lowercase("AΣ"))
        assertEquals("a.ς", JS.lowercase("A.Σ"))
        assertEquals("1e-7", JS.numberToString(1e-7))
        assertEquals("1e+21", JS.numberToString(1e21))
    }

    @Test
    fun display() {
        assertEquals("482 913", Display.group("482913"))
        assertEquals("123 4567", Display.group("1234567"))
        assertEquals("", Display.group(""))
        val hotp = keys[1].otp
        assertEquals(listOf(Badge.Hotp, Badge.Algorithm("SHA512"), Badge.Digits(8)), hotp.badges)
        assertEquals("Bank & Co" to "zoë", hotp.title to hotp.subtitle)
        assertEquals(null, OtpAccount(secret = "JBSWY3DP").title)
        assertEquals(listOf(Badge.Period(60)), OtpAccount(secret = "JBSWY3DP", period = 60).badges)
        assertEquals(30, Otp.secondsLeft(30, 0.0))
        assertEquals(1, Otp.secondsLeft(30, 59_999.0))
        assertEquals(Otp.totp("JBSWY3DPEHPK3PXP", nowMs = 59_000.0), Otp.code(OtpAccount(secret = "JBSWY3DPEHPK3PXP"), nowMs = 59_000.0))
    }

    @Test
    fun migrationPlanRoundTrip() {
        val accounts = (0 until 23).map { OtpAccount(issuer = "Service $it", account = "user$it@example.com", secret = Base32.encode(ByteArray(20) { b -> (it * 7 + b).toByte() })) }
        val plan = Migration.plan(accounts + OtpAccount(secret = "JBSWY3DP", digits = 7))
        assertEquals(listOf(Migration.Plan.Skip(23, Migration.Incompatibility.Digits(7))), plan.skipped)
        val results = plan.uris.map(Migration::parse)
        assertEquals(accounts, results.flatMap { it.accounts })
        assertEquals(results.indices.map { it.toLong() }, results.map { it.batch.index })
        assertTrue(results.all { it.batch.size == results.size.toLong() && it.batch.id == results[0].batch.id && it.batch.id in 0..Int.MAX_VALUE })
        assertTrue(plan.uris.all { it.length <= 1200 })
        assertEquals(JsonObject(emptyMap()), JS.parseJson("{}"))
    }
}
