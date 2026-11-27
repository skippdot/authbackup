package com.authbackup.core

import java.nio.ByteBuffer
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.math.floor
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.Serializable

/** The entry names are the strings of the extension's account object, so they serialize as "totp" and "hotp". */
@Serializable
enum class OtpType { totp, hotp }

@Serializable
enum class OtpAlgorithm {
    SHA1, SHA256, SHA512;

    internal val hmac: String get() = "Hmac$name"
}

/**
 * The OTP fields of one key, as in the extension's account object (docs/FORMATS.md, "Account object"). Every field is
 * written even when it has its default value, whatever the Json configuration, so the iOS app can read it back.
 */
@Serializable
data class OtpAccount(
    @EncodeDefault val type: OtpType = OtpType.totp,
    @EncodeDefault val issuer: String = "",
    @EncodeDefault val account: String = "",
    /** Upper-case Base32 without padding. */
    val secret: String,
    @EncodeDefault val algorithm: OtpAlgorithm = OtpAlgorithm.SHA1,
    @EncodeDefault val digits: Int = 6,
    /** Seconds; used by TOTP only. */
    @EncodeDefault val period: Int = 30,
    /** Used by HOTP only. */
    @EncodeDefault val counter: Long = 0,
) {
    /** The deduplication key of extension/lib/otpauth.js: the same secret under the same label is one key. */
    val dedupKey: String
        get() = "${type.name}|${Base32.normalize(secret)}|${JS.lowercase(issuer)}|${JS.lowercase(account)}"
}

/** HOTP (RFC 4226) and TOTP (RFC 6238). Port of extension/lib/totp.js. */
object Otp {
    /** The counter is written as 8 bytes big-endian in two's complement, as the extension's BigInt does it. */
    fun hotp(secret: String, counter: Long, digits: Int = 6, algorithm: OtpAlgorithm = OtpAlgorithm.SHA1): String {
        val key = Base32.decode(secret)
        // Web Crypto refuses an empty HMAC key (a one-character secret), and so does SecretKeySpec.
        if (key.isEmpty()) throw CoreError.Malformed("empty key")
        val mac = Mac.getInstance(algorithm.hmac)
        mac.init(SecretKeySpec(key, algorithm.hmac))
        val h = mac.doFinal(ByteBuffer.allocate(8).putLong(counter).array())
        // Dynamic truncation (RFC 4226 §5.3): the low 4 bits of the last byte are the offset.
        val offset = h[h.size - 1].toInt() and 0x0F
        val bin = ((h[offset].toInt() and 0x7F) shl 24) or ((h[offset + 1].toInt() and 0xFF) shl 16) or
            ((h[offset + 2].toInt() and 0xFF) shl 8) or (h[offset + 3].toInt() and 0xFF)
        var modulus = 1L
        repeat(minOf(digits, 10)) { modulus *= 10 }
        return (bin % modulus).toString().padStart(maxOf(digits, 0), '0')
    }

    /** Time step for a moment in milliseconds since 1970, computed like Math.floor(nowMs / 1000 / period). */
    fun timeStep(period: Int = 30, nowMs: Double): Long {
        val step = floor(nowMs / 1000 / period)
        // BigInt(Infinity) (a period of 0) is a RangeError in the extension.
        if (!step.isFinite()) throw CoreError.Malformed("time step")
        return step.toLong()
    }

    /** period - (Math.floor(nowMs / 1000) % period). */
    fun secondsLeft(period: Int = 30, nowMs: Double): Int = (period - floor(nowMs / 1000) % period).toInt()

    fun totp(secret: String, digits: Int = 6, algorithm: OtpAlgorithm = OtpAlgorithm.SHA1, period: Int = 30, nowMs: Double): String =
        hotp(secret, timeStep(period, nowMs), digits, algorithm)

    /** The current code of a key: TOTP from the clock, HOTP from its counter. */
    fun code(account: OtpAccount, nowMs: Double = System.currentTimeMillis().toDouble()): String = when (account.type) {
        OtpType.totp -> totp(account.secret, account.digits, account.algorithm, account.period, nowMs)
        OtpType.hotp -> hotp(account.secret, account.counter, account.digits, account.algorithm)
    }
}
