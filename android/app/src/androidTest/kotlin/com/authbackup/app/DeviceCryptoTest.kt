package com.authbackup.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.authbackup.core.Backup
import com.authbackup.core.CoreError
import com.authbackup.core.OtpAccount
import java.util.Base64
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The backup cases of tests/vectors/core.json on the device's own crypto provider. The core's vector tests run them on
 * the JDK; Android's PBKDF2 and AES-GCM come from a different provider (Conscrypt), and a backup file written by the
 * browser must open on the phone, a non-ASCII password included.
 */
@RunWith(AndroidJUnit4::class)
class DeviceCryptoTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val backup: JsonObject by lazy {
        val text = InstrumentationRegistry.getInstrumentation().context.assets.open("core.json").use { it.readBytes().decodeToString() }
        json.parseToJsonElement(text).jsonObject.getValue("backup").jsonObject
    }

    private fun cases(name: String): List<JsonObject> = backup.getValue(name).jsonArray.map { it.jsonObject }
    private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.takeIf { it.isString }?.content

    @Test
    fun pbkdf2() = section("pbkdf2", 5) { c ->
        val password = c.text("password")!!
        val key = Backup.deriveKey(password, Base64.getDecoder().decode(c.text("salt")), c.getValue("iterations").jsonPrimitive.int)
        check("\"$password\"", c.text("keyHex"), hex(key.encoded))
    }

    @Test
    fun aesGcm() = section("aesGcm", 6) { c ->
        val key = SecretKeySpec(bytes(c.text("keyHex")!!), "AES")
        val iv = bytes(c.text("ivHex")!!)
        check("seal", c.text("ctHex"), hex(Backup.seal(bytes(c.text("plainHex")!!), key, iv)))
        check("open", c.text("plainHex"), hex(Backup.open(bytes(c.text("ctHex")!!), key, iv)))
    }

    @Test
    fun backupFiles() = section("files", 8) { c ->
        val got: Any = try {
            when (val content = Backup.read(c.getValue("file").toString().encodeToByteArray())) {
                is Backup.Content.Encrypted -> Backup.restore(Backup.open(content.vault, c.text("password") ?: ""))
                is Backup.Content.Entries -> Backup.restore(content.entries)
                is Backup.Content.Links -> throw CoreError.NotBackup
            }
        } catch (e: CoreError) {
            e.key
        }
        check("password ${c.text("password")}", c.text("error") ?: accounts(c.getValue("accounts")), got)
    }

    /** Runs every case of a section and reports all mismatches at once, as the core's VectorTests do. */
    private fun section(name: String, count: Int, body: Failures.(JsonObject) -> Unit) {
        val cases = cases(name)
        assertEquals("$name: number of cases", count, cases.size)
        val failures = Failures()
        for ((i, c) in cases.withIndex()) {
            failures.case = i
            try {
                failures.body(c)
            } catch (e: Exception) {
                failures.list.add("case $i: $e")
            }
        }
        assertTrue("$name: ${failures.list.size} mismatches\n" + failures.list.joinToString("\n"), failures.list.isEmpty())
    }

    private class Failures {
        val list = mutableListOf<String>()
        var case = 0

        fun check(what: String, expected: Any?, actual: Any?) {
            if (expected != actual) list.add("case $case, $what\n    expected: $expected\n    actual:   $actual")
        }
    }

    private fun accounts(element: JsonElement): List<OtpAccount> =
        json.decodeFromJsonElement(ListSerializer(OtpAccount.serializer()), element as JsonArray)
}

private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

private fun bytes(hex: String): ByteArray = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
