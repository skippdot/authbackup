package com.authbackup.core

/** RFC 4648 Base32 (alphabet A-Z2-7), the form TOTP keys come in. Port of extension/lib/base32.js. */
object Base32 {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    /** Human input as a key: upper case, without whitespace, hyphens and "=" padding. */
    fun normalize(input: String): String = input.uppercase().filterNot { JS.isWhitespace(it) || it == '-' || it == '=' }

    private fun isAlphabet(s: String): Boolean = s.all { it in 'A'..'Z' || it in '2'..'7' }

    /** At least two characters: one is 5 bits, less than a byte, and HMAC needs a non-empty key. */
    fun isValid(input: String): Boolean {
        val s = normalize(input)
        return s.length >= 2 && isAlphabet(s)
    }

    fun decode(input: String): ByteArray {
        val s = normalize(input)
        if (!isAlphabet(s)) throw CoreError.Base32Chars
        val out = ByteArray(s.length * 5 / 8)
        var value = 0
        var bits = 0
        var index = 0
        for (c in s) {
            value = (value shl 5) or ALPHABET.indexOf(c)
            bits += 5
            if (bits >= 8) {
                out[index++] = (value ushr (bits - 8)).toByte()
                bits -= 8
            }
        }
        return out
    }

    /** Without "=" padding, as keys are written in otpauth:// links. */
    fun encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size * 8 + 4) / 5)
        var value = 0
        var bits = 0
        for (b in bytes) {
            value = (value shl 8) or (b.toInt() and 0xFF)
            bits += 8
            while (bits >= 5) {
                out.append(ALPHABET[(value ushr (bits - 5)) and 31])
                bits -= 5
            }
        }
        if (bits > 0) out.append(ALPHABET[(value shl (5 - bits)) and 31])
        return out.toString()
    }
}
