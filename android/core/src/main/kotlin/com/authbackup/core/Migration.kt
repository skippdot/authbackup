package com.authbackup.core

import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.SecureRandom
import kotlinx.serialization.Serializable

/**
 * Google Authenticator's export: otpauth-migration://offline?data=<base64(protobuf MigrationPayload)>.
 * Port of extension/lib/migration.js. Schema (from the Google Authenticator sources):
 *
 *     MigrationPayload { repeated OtpParameters otp_parameters = 1; int32 version = 2;
 *                        int32 batch_size = 3; int32 batch_index = 4; int32 batch_id = 5; }
 *     OtpParameters    { bytes secret = 1; string name = 2; string issuer = 3;
 *                        Algorithm algorithm = 4; DigitCount digits = 5; OtpType type = 6; int64 counter = 7; }
 */
object Migration {
    /** The batch fields as read; a value past Long (a negative int32 written as 10 bytes) is clamped. */
    @Serializable
    data class Batch(val index: Long, val size: Long, val id: Long)

    data class Skipped(
        /** The key's name or issuer; null when the export gives neither (the app shows "No name"). */
        val name: String?,
        val reason: CoreError,
    )

    data class Result(val accounts: List<OtpAccount>, val skipped: List<Skipped>, val batch: Batch)

    // Decoding

    /**
     * Protobuf varints are read in full (up to 70 bits) and then turned into a Double, as `Number(BigInt)` does in the
     * extension: damaged input must fail, or be skipped, in exactly the same places.
     */
    private class Reader(private val bytes: ByteArray) {
        private var pos = 0

        val done: Boolean get() = pos >= bytes.size

        fun varint(): BigInteger {
            var result = BigInteger.ZERO
            var shift = 0
            while (true) {
                // A protobuf varint is at most 10 bytes; a longer run is damage.
                if (pos >= bytes.size || shift > 63) throw CoreError.Truncated
                val byte = bytes[pos++].toInt() and 0xFF
                result = result.or(BigInteger.valueOf((byte and 0x7F).toLong()).shiftLeft(shift))
                if (byte and 0x80 == 0) return result
                shift += 7
            }
        }

        fun number(): Double = varint().toDouble()

        fun lengthDelimited(): ByteArray {
            val length = varint()
            if (length > BigInteger.valueOf((bytes.size - pos).toLong())) throw CoreError.Truncated
            val end = pos + length.toInt()
            return bytes.copyOfRange(pos, end).also { pos = end }
        }

        fun skip(wireType: Int) {
            when (wireType) {
                0 -> varint()
                2 -> lengthDelimited()
                1 -> fixed(8)
                5 -> fixed(4)
                else -> throw CoreError.WireType(wireType)
            }
        }

        private fun fixed(length: Int) {
            if (pos + length > bytes.size) throw CoreError.Truncated
            pos += length
        }

        /** The next field as (number, wire type), with the tag wrapped to 32 bits like `tag >>> 3` and `tag & 7` in JS. */
        fun field(): Pair<Long, Int> {
            val tag = toUInt32(number())
            return (tag ushr 3) to (tag and 7).toInt()
        }

        /** ECMAScript ToUint32 of an integral Number. */
        private fun toUInt32(x: Double): Long {
            if (!x.isFinite()) return 0
            val m = x % 4_294_967_296.0
            return (if (m < 0) m + 4_294_967_296.0 else m).toLong()
        }
    }

    private class Parameters {
        var secret = ByteArray(0)
        var name = ""
        var issuer = ""
        var algorithm = 0.0
        var digits = 0.0
        var type = 0.0
        var counter: BigInteger = BigInteger.ZERO
    }

    /** TextDecoder's default: invalid sequences become U+FFFD and a leading byte order mark is dropped. */
    private fun utf8(bytes: ByteArray): String = JS.utf8Decode(bytes, stripBom = true)

    private fun decodeParameters(bytes: ByteArray): Parameters {
        val r = Reader(bytes)
        val p = Parameters()
        while (!r.done) {
            val (field, wire) = r.field()
            when {
                field == 1L && wire == 2 -> p.secret = r.lengthDelimited()
                field == 2L && wire == 2 -> p.name = utf8(r.lengthDelimited())
                field == 3L && wire == 2 -> p.issuer = utf8(r.lengthDelimited())
                field == 4L && wire == 0 -> p.algorithm = r.number()
                field == 5L && wire == 0 -> p.digits = r.number()
                field == 6L && wire == 0 -> p.type = r.number()
                field == 7L && wire == 0 -> p.counter = r.varint()
                else -> r.skip(wire)
            }
        }
        return p
    }

    private fun decodePayload(bytes: ByteArray): Pair<List<Parameters>, Batch> {
        val r = Reader(bytes)
        val params = mutableListOf<Parameters>()
        var size = 0.0
        var index = 0.0
        var id = 0.0
        while (!r.done) {
            val (field, wire) = r.field()
            when {
                field == 1L && wire == 2 -> params.add(decodeParameters(r.lengthDelimited()))
                field == 2L && wire == 0 -> r.number()
                field == 3L && wire == 0 -> size = r.number()
                field == 4L && wire == 0 -> index = r.number()
                field == 5L && wire == 0 -> id = r.number()
                else -> r.skip(wire)
            }
        }
        // Double.toLong() saturates, like the clamping of the iOS port.
        return params to Batch(index = index.toLong(), size = size.toLong(), id = id.toLong())
    }

    private fun algorithm(code: Double): OtpAlgorithm? = when (code) {
        2.0 -> OtpAlgorithm.SHA256
        3.0 -> OtpAlgorithm.SHA512
        4.0 -> null // MD5
        else -> OtpAlgorithm.SHA1
    }

    private val MAX_SAFE_INTEGER: BigInteger = BigInteger.valueOf(9_007_199_254_740_991L)

    fun parse(uri: String): Result {
        val url = WebURL.parse(JS.trim(uri))
        if (url.scheme != "otpauth-migration") throw CoreError.NotMigration
        val data = url.queryParam("data")
        if (data.isNullOrEmpty()) throw CoreError.NoData
        val (params, batch) = decodePayload(JS.base64ToBytes(data))
        val accounts = mutableListOf<OtpAccount>()
        val skipped = mutableListOf<Skipped>()
        for (p in params) {
            val label = p.name.ifEmpty { p.issuer.ifEmpty { null } }
            val algorithm = algorithm(p.algorithm)
            if (algorithm == null) {
                skipped.add(Skipped(label, CoreError.Md5))
                continue
            }
            if (p.secret.isEmpty()) {
                skipped.add(Skipped(label, CoreError.NoSecret))
                continue
            }
            val type = if (p.type == 1.0) OtpType.hotp else OtpType.totp
            // int64 on the wire; beyond 2^53 a JS Number would silently round it.
            if (type == OtpType.hotp && p.counter > MAX_SAFE_INTEGER) {
                skipped.add(Skipped(label, CoreError.Counter(p.counter.toString())))
                continue
            }
            // Google puts "Issuer:account" in name if the original link had an issuer.
            var account = p.name
            if (p.issuer.isNotEmpty() && account.startsWith("${p.issuer}:")) account = account.substring(p.issuer.length + 1)
            accounts.add(
                OtpAccount(
                    type = type, issuer = JS.trim(p.issuer), account = JS.trim(account), secret = Base32.encode(p.secret),
                    algorithm = algorithm, digits = if (p.digits == 2.0) 8 else 6,
                    period = 30, // the format has no period: Google always uses 30 s
                    counter = if (type == OtpType.hotp) p.counter.toLong() else 0,
                ),
            )
        }
        return Result(accounts, skipped, batch)
    }

    // Encoding

    /** A varint like the extension's BigInt loop: a negative value is cut to its low 7 bits, as `>> 7n` keeps it negative. */
    private fun ByteArrayOutputStream.varint(value: Long) {
        var v = value
        do {
            var byte = (v and 0x7F).toInt()
            v = v shr 7
            if (v > 0) byte = byte or 0x80
            write(byte)
        } while (v > 0)
    }

    private fun ByteArrayOutputStream.fieldVarint(field: Int, value: Long) {
        varint(field.toLong() shl 3)
        varint(value)
    }

    private fun ByteArrayOutputStream.fieldBytes(field: Int, bytes: ByteArray) {
        varint((field.toLong() shl 3) or 2)
        varint(bytes.size.toLong())
        write(bytes)
    }

    private fun code(a: OtpAlgorithm): Long = when (a) {
        OtpAlgorithm.SHA1 -> 1
        OtpAlgorithm.SHA256 -> 2
        OtpAlgorithm.SHA512 -> 3
    }

    /** Throws [CoreError.Base32Chars] for a secret that is not Base32, as the extension does. */
    fun build(accounts: List<OtpAccount>, batchIndex: Long = 0, batchSize: Long = 1, batchId: Long = 1): String {
        val body = ByteArrayOutputStream()
        for (a in accounts) {
            val name = if (a.issuer.isEmpty()) a.account else "${a.issuer}:${a.account}"
            val params = ByteArrayOutputStream()
            params.fieldBytes(1, Base32.decode(a.secret))
            params.fieldBytes(2, JS.utf8Encode(name))
            params.fieldBytes(3, JS.utf8Encode(a.issuer))
            params.fieldVarint(4, code(a.algorithm))
            params.fieldVarint(5, if (a.digits == 8) 2 else 1)
            params.fieldVarint(6, if (a.type == OtpType.hotp) 1 else 2)
            if (a.type == OtpType.hotp) params.fieldVarint(7, a.counter)
            body.fieldBytes(1, params.toByteArray())
        }
        body.fieldVarint(2, 1)
        body.fieldVarint(3, batchSize)
        body.fieldVarint(4, batchIndex)
        body.fieldVarint(5, batchId)
        return "otpauth-migration://offline?data=${JS.encodeURIComponent(JS.bytesToBase64(body.toByteArray()))}"
    }

    // Export "like Google Authenticator"

    sealed class Incompatibility {
        data class Period(val period: Int) : Incompatibility()
        data class Digits(val digits: Int) : Incompatibility()

        val key: String
            get() = when (this) {
                is Period -> "gaIncompatPeriod"
                is Digits -> "gaIncompatDigits"
            }
    }

    /** Why a key cannot be carried by the export format without loss, or null if it can. */
    fun incompatibility(a: OtpAccount): Incompatibility? {
        if (a.type == OtpType.totp && a.period != 30) return Incompatibility.Period(a.period)
        if (a.digits != 6 && a.digits != 8) return Incompatibility.Digits(a.digits)
        return null
    }

    data class Plan(
        val uris: List<String>,
        val groups: List<List<OtpAccount>>,
        /** Indexes into the input with the reason each key was left out. */
        val skipped: List<Skip>,
    ) {
        data class Skip(val index: Int, val reason: Incompatibility)
    }

    /**
     * Splits keys into QR codes of up to [maxPerQr] keys and [maxUriLength] characters, as Google does (about 10):
     * denser codes read poorly from a screen. The length is estimated with the default batch fields, like the extension.
     */
    fun plan(accounts: List<OtpAccount>, maxPerQr: Int = 10, maxUriLength: Int = 1200, batchId: Long? = null): Plan {
        val skipped = mutableListOf<Plan.Skip>()
        val ok = mutableListOf<OtpAccount>()
        for ((i, a) in accounts.withIndex()) {
            val reason = incompatibility(a)
            if (reason != null) skipped.add(Plan.Skip(i, reason)) else ok.add(a)
        }
        val groups = mutableListOf<List<OtpAccount>>()
        var current = listOf<OtpAccount>()
        for (a in ok) {
            val next = current + a
            if (current.isNotEmpty() && (next.size > maxPerQr || build(next).length > maxUriLength)) {
                groups.add(current)
                current = listOf(a)
            } else {
                current = next
            }
        }
        if (current.isNotEmpty()) groups.add(current)
        val id = batchId ?: (SecureRandom().nextInt() and 0x7FFF_FFFF).toLong()
        val uris = groups.mapIndexed { i, g -> build(g, batchIndex = i.toLong(), batchSize = groups.size.toLong(), batchId = id) }
        return Plan(uris, groups, skipped)
    }
}
