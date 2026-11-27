package com.authbackup.core


import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * tests/vectors/core.json is written by the extension's JS core (`npm run vectors`); the Kotlin core must agree with it
 * on every case, errors included. A failure here means the phone would read a link, an export or a backup file
 * differently from the browser. Every section's case count is asserted, so a section missing from the file (or skipped
 * by the decoder) fails too.
 */
@Serializable
data class Vectors(
    val base32: Base32Set,
    val otp: OtpSet,
    val otpauth: OtpauthSet,
    val migration: MigrationSet,
    val accountKey: List<KeyCase>,
    val restore: List<Restore>,
    val backup: BackupSet,
) {
    @Serializable
    data class Base32Set(val encode: List<Encode>, val decode: List<Decode>, val valid: List<Valid>) {
        @Serializable data class Encode(val hex: String, val base32: String)
        @Serializable data class Decode(val input: String, val result: String? = null, val error: String? = null)
        @Serializable data class Valid(val input: String, val valid: Boolean)
    }

    @Serializable
    data class OtpSet(val totp: List<Totp>, val hotp: List<Hotp>) {
        @Serializable data class Totp(val secret: String, val algorithm: OtpAlgorithm, val digits: Int, val period: Int, val at: Long, val code: String)
        @Serializable data class Hotp(val secret: String, val algorithm: OtpAlgorithm, val digits: Int, val counter: Long, val code: String)
    }

    @Serializable
    data class OtpauthSet(val parse: List<Parse>, val build: List<Build>, val any: List<AnyText>) {
        @Serializable data class Parse(val uri: String, val result: OtpAccount? = null, val error: String? = null)
        @Serializable data class Build(val account: OtpAccount, val uri: String)
        @Serializable data class AnyText(val text: String, val result: String? = null, val error: String? = null)
    }

    @Serializable
    data class Options(val batchIndex: Long? = null, val batchSize: Long? = null, val batchId: Long? = null, val maxPerQr: Int? = null, val maxUriLength: Int? = null)

    @Serializable
    data class MigrationSet(val parse: List<Parse>, val build: List<Build>, val plan: List<Plan>) {
        @Serializable data class Skip(val name: String, val reason: String)
        @Serializable data class Outcome(val accounts: List<OtpAccount>, val skipped: List<Skip>, val batch: Migration.Batch)
        @Serializable data class Parse(val uri: String, val result: Outcome? = null, val error: String? = null)
        @Serializable data class Build(val accounts: List<OtpAccount>, val options: Options, val uri: String)
        @Serializable data class PlanSkip(val index: Int, val reason: String)
        @Serializable data class Plan(val accounts: List<OtpAccount>, val options: Options, val uris: List<String>, val skipped: List<PlanSkip>)
    }

    @Serializable
    data class KeyCase(val account: Loose, val key: String) {
        @Serializable data class Loose(val type: OtpType, val issuer: String? = null, val account: String? = null, val secret: String)
    }

    @Serializable data class Restore(val entry: JsonElement, val result: OtpAccount? = null, val error: String? = null)

    @Serializable
    data class BackupSet(val files: List<File>, val pbkdf2: List<Pbkdf2>, val aesGcm: List<AesGcm>) {
        @Serializable data class File(val file: JsonElement, val password: String? = null, val accounts: List<OtpAccount>? = null, val error: String? = null)
        @Serializable data class Pbkdf2(val password: String, val salt: String, val iterations: Int, val keyHex: String)
        @Serializable data class AesGcm(val keyHex: String, val ivHex: String, val plainHex: String, val ctHex: String)
    }

    companion object {
        /** The vector file's path comes from the "vectors" system property (set in core/build.gradle.kts). */
        val shared: Vectors by lazy {
            val path = System.getProperty("vectors") ?: error("system property \"vectors\" is not set")
            vectorsJson.decodeFromString(serializer(), java.io.File(path).readText())
        }

        // Unknown keys are ignored (the loose accounts carry more fields than they need), hence the counts below.
        private val vectorsJson = Json { ignoreUnknownKeys = true }
    }
}

private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 0xFF) }

private fun bytes(hex: String): ByteArray = ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

/** The result or the error key, so one comparison covers both outcomes. */
private sealed class Outcome<out T> {
    data class Success<T>(val value: T) : Outcome<T>()
    data class Failure(val key: String) : Outcome<Nothing>()
}

private fun <T> outcome(body: () -> T): Outcome<T> = try {
    Outcome.Success(body())
} catch (e: CoreError) {
    Outcome.Failure(e.key)
} catch (e: Exception) {
    Outcome.Failure("unexpected $e")
}

private fun <T> expected(result: T?, error: String?): Outcome<T> = when {
    error != null -> Outcome.Failure(error)
    result != null -> Outcome.Success(result)
    else -> error("a case without result and error")
}

/** Collects every mismatch of a section, so one run reports all of them, and checks how many cases ran. */
private class Section(private val name: String, private val count: Int) {
    private val failures = mutableListOf<String>()
    private var ran = 0

    fun case(body: Section.() -> Unit) {
        ran++
        body()
    }

    fun check(expected: Any?, actual: Any?, what: () -> String) {
        if (expected != actual) failures.add("${what()}\n    expected: $expected\n    actual:   $actual")
    }

    fun finish() {
        assertTrue(failures.isEmpty(), "$name: ${failures.size} mismatches\n" + failures.joinToString("\n"))
        assertEquals(count, ran, "$name: number of cases")
    }
}

private fun section(name: String, count: Int, body: Section.() -> Unit) = Section(name, count).apply(body).finish()

private val compactJson = Json

class VectorTests {
    private val v = Vectors.shared

    @Test
    fun base32() {
        section("base32 encode", 47) {
            for (c in v.base32.encode) case {
                check(c.base32, Base32.encode(bytes(c.hex))) { "encode ${c.hex}" }
                check(Outcome.Success(c.hex), outcome { hex(Base32.decode(c.base32)) }) { "decode ${c.base32}" }
            }
        }
        section("base32 decode", 18) {
            for (c in v.base32.decode) case { check(expected(c.result, c.error), outcome { hex(Base32.decode(c.input)) }) { "decode \"${c.input}\"" } }
        }
        section("base32 valid", 18) {
            for (c in v.base32.valid) case { check(c.valid, Base32.isValid(c.input)) { "valid \"${c.input}\"" } }
        }
    }

    @Test
    fun totpAndHotp() {
        section("otp totp", 265) {
            for (c in v.otp.totp) case {
                val code = outcome { Otp.totp(c.secret, c.digits, c.algorithm, c.period, nowMs = c.at * 1000.0) }
                check(Outcome.Success(c.code), code) { "totp ${c.secret} ${c.algorithm} ${c.digits} ${c.period} at ${c.at}" }
            }
        }
        section("otp hotp", 54) {
            for (c in v.otp.hotp) case {
                check(Outcome.Success(c.code), outcome { Otp.hotp(c.secret, c.counter, c.digits, c.algorithm) }) { "hotp ${c.secret} ${c.counter}" }
            }
        }
    }

    @Test
    fun otpauthLinks() {
        section("otpauth parse", 80) {
            for (c in v.otpauth.parse) case { check(expected(c.result, c.error), outcome { Otpauth.parse(c.uri) }) { "parse \"${c.uri}\"" } }
        }
        section("otpauth build", 6) {
            for (c in v.otpauth.build) case { check(c.uri, Otpauth.build(c.account)) { "build ${c.account}" } }
        }
        section("otpauth any", 9) {
            for (c in v.otpauth.any) case {
                val kind = outcome {
                    when (Otpauth.parseAny(c.text)) {
                        is Otpauth.Parsed.Otpauth -> "otpauth"
                        is Otpauth.Parsed.Migration -> "migration"
                    }
                }
                check(expected(c.result, c.error), kind) { "parseAny \"${c.text}\"" }
            }
        }
    }

    private data class MigrationView(val accounts: List<OtpAccount>, val skipped: List<String>, val batch: Migration.Batch)

    @Test
    fun googleAuthenticatorExport() {
        section("migration parse", 30) {
            for (c in v.migration.parse) case {
                val got = outcome {
                    val r = Migration.parse(c.uri)
                    MigrationView(r.accounts, r.skipped.map { "${it.name ?: "noName"}|${it.reason.key}" }, r.batch)
                }
                val want = expected(c.result?.let { r -> MigrationView(r.accounts, r.skipped.map { "${it.name}|${it.reason}" }, r.batch) }, c.error)
                check(want, got) { "parse ${c.uri}" }
            }
        }
        section("migration build", 3) {
            for (c in v.migration.build) case {
                val uri = Migration.build(c.accounts, c.options.batchIndex ?: 0, c.options.batchSize ?: 1, c.options.batchId ?: 1)
                check(c.uri, uri) { "build ${c.accounts.size} keys ${c.options}" }
            }
        }
        section("migration plan", 3) {
            for (c in v.migration.plan) case {
                val p = Migration.plan(c.accounts, c.options.maxPerQr ?: 10, c.options.maxUriLength ?: 1200, c.options.batchId)
                check(c.uris, p.uris) { "plan uris ${c.options}" }
                check(c.skipped.map { "${it.index}|${it.reason}" }, p.skipped.map { "${it.index}|${it.reason.key}" }) { "plan skipped ${c.options}" }
            }
        }
    }

    @Test
    fun dedupKeys() {
        section("accountKey", 9) {
            for (c in v.accountKey) case {
                val a = OtpAccount(type = c.account.type, issuer = c.account.issuer ?: "", account = c.account.account ?: "", secret = c.account.secret)
                check(c.key, a.dedupKey) { "key ${c.account}" }
            }
        }
    }

    @Test
    fun restoreEntries() {
        section("restore", 58) {
            for (c in v.restore) case { check(expected(c.result, c.error), outcome { Backup.restore(c.entry) }) { "restore ${c.entry}" } }
        }
    }

    @Test
    fun backupFiles() {
        section("backup files", 19) {
            for (c in v.backup.files) case {
                val got = outcome {
                    when (val content = Backup.read(compactJson.encodeToString(JsonElement.serializer(), c.file).encodeToByteArray())) {
                        is Backup.Content.Encrypted -> Backup.restore(Backup.open(content.vault, c.password ?: ""))
                        is Backup.Content.Entries -> Backup.restore(content.entries)
                        is Backup.Content.Links -> throw CoreError.NotBackup
                    }
                }
                check(expected(c.accounts, c.error), got) { "file, password ${c.password ?: "none"}" }
            }
        }
    }

    @Test
    fun pbkdf2AndAesGcm() {
        section("backup pbkdf2", 5) {
            for (c in v.backup.pbkdf2) case {
                val key = Backup.deriveKey(c.password, JS.base64ToBytes(c.salt), c.iterations)
                check(c.keyHex, hex(key.encoded)) { "pbkdf2 \"${c.password}\" x${c.iterations}" }
            }
        }
        section("backup aesGcm", 6) {
            for (c in v.backup.aesGcm) case {
                val key = SecretKeySpec(bytes(c.keyHex), "AES")
                check(c.ctHex, hex(Backup.seal(bytes(c.plainHex), key, bytes(c.ivHex)))) { "seal ${c.plainHex.length / 2} bytes" }
                check(c.plainHex, hex(Backup.open(bytes(c.ctHex), key, bytes(c.ivHex)))) { "open ${c.plainHex.length / 2} bytes" }
            }
        }
    }
}
