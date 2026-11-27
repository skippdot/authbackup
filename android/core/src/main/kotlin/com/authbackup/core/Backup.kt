package com.authbackup.core

import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// Backup files are read as JSON first and checked field by field afterwards, the way the extension reads them, so a
// file that one app accepts the other accepts too. These helpers give a JsonElement the JS semantics the checks rely on.

/** `x.name` in JS: the member of an object; null (undefined) for a missing member or anything but an object. */
internal fun JsonElement?.member(name: String): JsonElement? = (this as? JsonObject)?.get(name)

private val JsonPrimitive.isBoolean: Boolean get() = !isString && (content == "true" || content == "false")

/** The value of a JSON number, or null for anything else. */
internal val JsonElement?.numberValue: Double?
    get() = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && !it.isString && !it.isBoolean }?.let { it.content.toDoubleOrNull() ?: Double.NaN }

/** The value of a JSON string, or null for anything else. */
internal val JsonElement?.stringValue: String? get() = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

/** JS truthiness. */
internal val JsonElement.truthy: Boolean
    get() = when (this) {
        is JsonNull -> false
        is JsonPrimitive -> when {
            isString -> content.isNotEmpty()
            isBoolean -> content == "true"
            else -> (numberValue ?: Double.NaN).let { it != 0.0 && !it.isNaN() }
        }
        is JsonArray, is JsonObject -> true
    }

/** JS String(x). */
internal val JsonElement.jsString: String
    get() = when (this) {
        is JsonNull -> "null"
        is JsonPrimitive -> if (isString || isBoolean) content else JS.numberToString(numberValue!!)
        is JsonArray -> joinToString(",") { if (it is JsonNull) "" else it.jsString }
        is JsonObject -> "[object Object]"
    }

/**
 * A key as the app stores it: the OTP fields plus the bookkeeping fields of the extension's account object
 * (`id`, `source`, `addedAt`), flat, so a backup file from either app restores in the other.
 */
@Serializable(with = StoredAccountSerializer::class)
data class StoredAccount(
    val id: String = UUID.randomUUID().toString(),
    val otp: OtpAccount,
    /** Where the key came from: "qr", "image", "link", "manual", "google", "backup". */
    val source: String,
    /** ISO 8601 with milliseconds, like Date.prototype.toISOString(). */
    val addedAt: String = Backup.isoNow(),
)

/**
 * The flat JSON object of [StoredAccount], as the iOS app writes it: the OTP fields next to `id`, `source` and
 * `addedAt`. `id` is required; a missing `source` reads as "backup" and a missing `addedAt` as "". Other members are ignored.
 */
object StoredAccountSerializer : KSerializer<StoredAccount> {
    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("com.authbackup.core.StoredAccount")

    private val otpFields = OtpAccount.serializer().descriptor.let { d -> (0 until d.elementsCount).map(d::getElementName).toSet() }

    override fun serialize(encoder: Encoder, value: StoredAccount) {
        val out = (encoder as? JsonEncoder) ?: throw SerializationException("StoredAccount is written as JSON only")
        val otp = out.json.encodeToJsonElement(OtpAccount.serializer(), value.otp) as JsonObject
        out.encodeJsonElement(
            JsonObject(
                otp + mapOf("id" to JsonPrimitive(value.id), "source" to JsonPrimitive(value.source), "addedAt" to JsonPrimitive(value.addedAt)),
            ),
        )
    }

    override fun deserialize(decoder: Decoder): StoredAccount {
        val input = (decoder as? JsonDecoder) ?: throw SerializationException("StoredAccount is read from JSON only")
        val obj = input.decodeJsonElement() as? JsonObject ?: throw SerializationException("StoredAccount: expected an object")
        val otp = input.json.decodeFromJsonElement(OtpAccount.serializer(), JsonObject(obj.filterKeys { it in otpFields }))
        fun text(name: String): String? = obj[name]?.let { it.stringValue ?: throw SerializationException("StoredAccount: $name is not a string") }
        return StoredAccount(
            id = text("id") ?: throw SerializationException("StoredAccount: missing id"),
            otp = otp,
            source = text("source") ?: "backup",
            addedAt = text("addedAt") ?: "",
        )
    }
}

/**
 * Backup files, as described in docs/FORMATS.md: the plain JSON backup (version 1), the encrypted backup (version 2,
 * PBKDF2-SHA256 → AES-256-GCM, the `{ v, kdf, iv, ct }` object of extension/lib/vault.js) and text files with links.
 */
object Backup {
    const val DEFAULT_ITERATIONS = 600_000 // OWASP recommendation for PBKDF2-SHA256, as in the extension
    const val MIN_PASSWORD = 8

    /** A file asking for more makes the phone hang for minutes; the extension never writes more than the default. */
    internal const val MAX_ITERATIONS = 10_000_000

    sealed class Content {
        /** The `encrypted` object of a version 2 file: needs the file's password. */
        data class Encrypted(val vault: JsonElement) : Content()

        /** Entries of a version 1 file or of a bare JSON array, not yet validated. */
        data class Entries(val entries: List<JsonElement>) : Content()

        /** Not JSON, but mentions otpauth: links to show in the import preview. */
        data class Links(val text: String) : Content()
    }

    /** What a file holds. A text file with links is returned as [Content.Links]; anything else that is not JSON is `notBackup`. */
    fun read(data: ByteArray): Content {
        // Blob.text(): UTF-8 with a leading byte order mark dropped and invalid bytes replaced.
        val text = JS.utf8Decode(data, stripBom = true)
        val json = try {
            JS.parseJson(text)
        } catch (e: CoreError.Malformed) {
            if (JS.containsIgnoringAsciiCase(text, "otpauth")) return Content.Links(text)
            throw CoreError.NotBackup
        }
        json.member("encrypted")?.let { if (it.truthy) return Content.Encrypted(it) }
        if (json is JsonArray) return Content.Entries(json)
        (json.member("accounts") as? JsonArray)?.let { return Content.Entries(it) }
        throw CoreError.NotBackup
    }

    /** Validates every entry like a link (backupEntryToAccount in the extension). One bad entry rejects the whole file. */
    fun restore(entries: List<JsonElement>): List<OtpAccount> = entries.map { restore(it) }

    /**
     * One backup entry: missing fields get the defaults of a link, then the entry is written as an otpauth:// link
     * and parsed again, exactly as the extension does it. Before that, each field the key uses must have its JSON
     * type, nothing is coerced: `type` is totp or hotp in any letter case, `secret` and `algorithm` are strings, and
     * `digits`, `period` (totp) and `counter` (hotp) are safe integers. `issuer` and `account` are read as text.
     */
    fun restore(entry: JsonElement): OtpAccount {
        val m = linkedMapOf<String, JsonElement>(
            "type" to JsonPrimitive("totp"), "algorithm" to JsonPrimitive("SHA1"), "digits" to JsonPrimitive(6), "period" to JsonPrimitive(30),
            "counter" to JsonPrimitive(0),
        )
        if (entry is JsonObject) m.putAll(entry)
        fun text(name: String) = m[name]?.jsString ?: "undefined"
        val type = m["type"].stringValue?.let(JS::lowercase)?.takeIf { it == "totp" || it == "hotp" } ?: throw CoreError.UnknownType(text("type"))
        // A missing secret would be written as the text "undefined", which is valid Base32: refused, as in the extension.
        val secret = m["secret"].stringValue ?: throw CoreError.NoSecret
        val algorithm = m["algorithm"].stringValue ?: throw CoreError.Algorithm(text("algorithm"))
        val digits = safeInteger(m["digits"]) ?: throw CoreError.Digits(text("digits"))
        val account = m["account"]?.takeIf { it !is JsonNull }?.jsString ?: ""
        val issuer = m["issuer"]?.takeIf { it.truthy }?.jsString
        val label = JS.encodeURIComponent(if (issuer != null) "$issuer:$account" else account)
        val query = mutableListOf("secret" to secret)
        if (issuer != null) query.add("issuer" to issuer)
        query.add("algorithm" to algorithm)
        query.add("digits" to digits)
        if (type == "hotp") {
            query.add("counter" to (safeInteger(m["counter"]) ?: throw CoreError.Counter(text("counter"))))
        } else {
            query.add("period" to (safeInteger(m["period"]) ?: throw CoreError.Period(text("period"))))
        }
        val search = query.joinToString("&") { "${JS.formEncode(it.first)}=${JS.formEncode(it.second)}" }
        return Otpauth.parse("otpauth://$type/$label?$search")
    }

    /**
     * A JSON number that Number.isSafeInteger() accepts, as String() writes it: plain digits, so the link's own checks
     * see the same number (String(1e21) is "1e+21", which parseInt reads as 1). Null for anything else.
     */
    private fun safeInteger(value: JsonElement?): String? = value.numberValue?.takeIf(JS::isSafeInteger)?.let(JS::numberToString)

    // Encryption

    /**
     * PBKDF2-HMAC-SHA256 → a 256-bit AES key. The JDK hashes the password as UTF-8, which is TextEncoder's output once
     * lone surrogates are replaced as TextEncoder replaces them.
     */
    fun deriveKey(password: String, salt: ByteArray, iterations: Int): SecretKey {
        if (iterations !in 1..MAX_ITERATIONS) throw CoreError.Malformed("iterations")
        // Web Crypto takes an empty salt and an empty password. PBEKeySpec refuses the first and Android's provider the
        // second ("Could not generate secret key"); no app writes either, but a file may carry them.
        if (salt.isEmpty() || password.isEmpty()) return SecretKeySpec(pbkdf2Block(JS.utf8Encode(password), salt, iterations), "AES")
        val spec = PBEKeySpec(JS.toUSV(password).toCharArray(), salt, iterations, 256)
        try {
            val raw = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            return SecretKeySpec(raw, "AES")
        } catch (e: GeneralSecurityException) {
            throw CoreError.Malformed("PBKDF2 failed: ${e.message}")
        } finally {
            spec.clearPassword()
        }
    }

    /** RFC 8018 PBKDF2 with HMAC-SHA256 for one 32-byte block: T1 = U1 ^ U2 ^ ... with U1 = HMAC(P, S || 1). */
    internal fun pbkdf2Block(password: ByteArray, salt: ByteArray, iterations: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        // SecretKeySpec refuses an empty key, HMAC itself does not (an empty password is a valid one).
        mac.init(object : SecretKey {
            override fun getAlgorithm() = "HmacSHA256"
            override fun getFormat() = "RAW"
            override fun getEncoded() = password.copyOf()
        })
        var u = mac.doFinal(salt + byteArrayOf(0, 0, 0, 1))
        val t = u.copyOf()
        repeat(iterations - 1) {
            u = mac.doFinal(u)
            for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
        }
        return t
    }

    /** AES-256-GCM in the Web Crypto layout: ciphertext followed by the 16-byte tag. */
    fun seal(plain: ByteArray, key: SecretKey, iv: ByteArray): ByteArray = try {
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))
            doFinal(plain)
        }
    } catch (e: GeneralSecurityException) {
        throw CoreError.Malformed("AES-GCM failed: ${e.message}")
    } catch (e: IllegalArgumentException) {
        throw CoreError.Malformed("AES-GCM failed: ${e.message}")
    }

    /** A wrong key and a changed ciphertext both fail the tag check: `wrongPassword`, never garbage. */
    fun open(ct: ByteArray, key: SecretKey, iv: ByteArray): ByteArray {
        if (ct.size < 16) throw CoreError.WrongPassword
        return try {
            Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
                doFinal(ct)
            }
        } catch (e: GeneralSecurityException) { // AEADBadTagException among them
            throw CoreError.WrongPassword
        } catch (e: IllegalArgumentException) {
            throw CoreError.WrongPassword
        }
    }

    /** Opens the `encrypted` object of a version 2 file and returns the entries inside, not yet validated. */
    fun open(vault: JsonElement, password: String): List<JsonElement> {
        val kdf = vault.member("kdf")
        if (vault.member("v").numberValue != 1.0 || kdf.member("name").stringValue != "PBKDF2-SHA256") throw CoreError.VaultFormat
        val iterations = iterations(kdf.member("iterations"))
        val salt = JS.base64ToBytes(kdf.member("salt").stringValue ?: throw CoreError.Malformed("salt"))
        val key = deriveKey(password, salt, iterations)
        // In the extension the IV and ciphertext are decoded inside the decrypt call: damage there is a wrong password too.
        val (iv, ct) = try {
            JS.base64ToBytes(vault.member("iv").stringValue ?: throw CoreError.WrongPassword) to
                JS.base64ToBytes(vault.member("ct").stringValue ?: throw CoreError.WrongPassword)
        } catch (e: CoreError) {
            throw CoreError.WrongPassword
        }
        val plain = open(ct, key, iv)
        val data = JS.parseJson(JS.utf8Decode(plain, stripBom = true))
        return data.member("accounts") as? JsonArray ?: throw CoreError.Malformed("accounts")
    }

    /**
     * The `iterations` member as the apps write it, a whole JSON number from 1 to [MAX_ITERATIONS], as in the extension:
     * no default for a missing one, no Web IDL conversion of `true` or "1000".
     */
    private fun iterations(value: JsonElement?): Int {
        val n = value.numberValue ?: throw CoreError.VaultFormat
        if (n % 1.0 != 0.0 || n < 1 || n > MAX_ITERATIONS) throw CoreError.VaultFormat
        return n.toInt()
    }

    private val random = SecureRandom()

    private fun randomBytes(count: Int): ByteArray = ByteArray(count).also(random::nextBytes)

    // Writing

    private val json = Json

    /** Keys sorted at every level, like the iOS app's JSONEncoder with `.sortedKeys`. */
    private fun sorted(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.entries.sortedBy { it.key }.associate { it.key to sorted(it.value) })
        is JsonArray -> JsonArray(e.map(::sorted))
        else -> e
    }

    private fun write(e: JsonElement): ByteArray = json.encodeToString(JsonElement.serializer(), sorted(e)).encodeToByteArray()

    private fun accountsJson(accounts: List<StoredAccount>): JsonArray =
        JsonArray(accounts.map { json.encodeToJsonElement(StoredAccount.serializer(), it) })

    /** `authbackup-<date>.encrypted.json`, the same file the extension writes. */
    fun encryptedFile(accounts: List<StoredAccount>, password: String, iterations: Int = DEFAULT_ITERATIONS, now: Instant = Instant.now()): ByteArray {
        val salt = randomBytes(16)
        val iv = randomBytes(12)
        val key = deriveKey(password, salt, iterations)
        val ct = seal(write(JsonObject(mapOf("accounts" to accountsJson(accounts)))), key, iv)
        val kdf = JsonObject(mapOf("name" to JsonPrimitive("PBKDF2-SHA256"), "iterations" to JsonPrimitive(iterations), "salt" to JsonPrimitive(JS.bytesToBase64(salt))))
        val vault = JsonObject(mapOf("v" to JsonPrimitive(1), "kdf" to kdf, "iv" to JsonPrimitive(JS.bytesToBase64(iv)), "ct" to JsonPrimitive(JS.bytesToBase64(ct))))
        return write(
            JsonObject(
                mapOf(
                    "app" to JsonPrimitive("authbackup"), "version" to JsonPrimitive(2), "exportedAt" to JsonPrimitive(isoString(now)),
                    "count" to JsonPrimitive(accounts.size), "encrypted" to vault,
                ),
            ),
        )
    }

    /** `authbackup-<date>.json`: the keys in plain text. */
    fun plainFile(accounts: List<StoredAccount>, now: Instant = Instant.now()): ByteArray = write(
        JsonObject(
            mapOf(
                "app" to JsonPrimitive("authbackup"), "version" to JsonPrimitive(1), "exportedAt" to JsonPrimitive(isoString(now)),
                "accounts" to accountsJson(accounts),
            ),
        ),
    )

    /** One otpauth:// link per line, for other authenticators. */
    fun otpauthText(accounts: List<StoredAccount>): String = accounts.joinToString("") { Otpauth.build(it.otp) + "\n" }

    private val iso = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    /** Date.prototype.toISOString(): UTC with milliseconds. */
    fun isoString(instant: Instant): String = iso.format(instant)

    fun isoNow(): String = isoString(Instant.now())
}
