package com.authbackup.core

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import java.util.Base64
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The few JavaScript built-ins whose exact behavior the extension's parsers depend on. Reproducing them (rather than
 * using the JDK's nearest equivalents) is what makes a link or a backup read the same in the browser and on the phone.
 * Kotlin strings are UTF-16 like JS strings, so lengths, indexes and startsWith carry over unchanged.
 */
internal object JS {
    /** WhiteSpace and LineTerminator of ECMAScript: what String.prototype.trim(), parseInt() and `\s` skip. */
    fun isWhitespace(c: Char): Boolean = when (c.code) {
        in 0x09..0x0D, 0x20, 0xA0, 0x1680, in 0x2000..0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF -> true
        else -> false
    }

    /** String.prototype.trim(). */
    fun trim(s: String): String = s.trim(::isWhitespace)

    /** `s.replace(/\s/g, '')`. */
    fun removingWhitespace(s: String): String = s.filterNot(::isWhitespace)

    /** parseInt(s, 10) as a JS Number; null stands for NaN. "6abc" is 6, " +8" is 8, "1.5" is 1, "abc" is NaN. */
    fun parseInt(s: String): Double? {
        var i = 0
        while (i < s.length && isWhitespace(s[i])) i++
        var sign = 1.0
        if (i < s.length && (s[i] == '-' || s[i] == '+')) {
            if (s[i] == '-') sign = -1.0
            i++
        }
        val start = i
        while (i < s.length && s[i] in '0'..'9') i++
        if (i == start) return null
        return sign * s.substring(start, i).toDouble() // correctly rounded, as V8 does for long digit runs
    }

    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0

    /** Number.isSafeInteger(x) && x >= 0. */
    fun isSafeNonNegativeInteger(x: Double): Boolean = x >= 0 && x <= MAX_SAFE_INTEGER && x % 1.0 == 0.0

    /**
     * String(x) for a JS Number (Number::toString): the shortest digits that read back as x, written as JS writes
     * them ("1e+21", "0.00001", "1e-7", "12345678901234567000"). The JDK's own Double.toString differs in all of these.
     */
    fun numberToString(x: Double): String {
        if (x.isNaN()) return "NaN"
        if (x == 0.0) return "0"
        if (x < 0) return "-" + numberToString(-x)
        if (x.isInfinite()) return "Infinity"
        if (x < 9.007199254740992E15 && x % 1.0 == 0.0) return x.toLong().toString()
        val (digits, n) = shortestDigits(x)
        val k = digits.length
        return when {
            n in k..21 -> digits + "0".repeat(n - k)
            n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
            n in -5..0 -> "0." + "0".repeat(-n) + digits
            else -> {
                val e = n - 1
                (if (k == 1) digits else digits[0] + "." + digits.substring(1)) + (if (e < 0) "e-${-e}" else "e+$e")
            }
        }
    }

    /** The digits s (without trailing zeros) and exponent n with x = 0.s × 10^n, s as short as possible, then closest. */
    private fun shortestDigits(x: Double): Pair<String, Int> {
        val exact = BigDecimal(x)
        for (precision in 1..17) {
            val down = exact.round(MathContext(precision, RoundingMode.FLOOR))
            val up = exact.round(MathContext(precision, RoundingMode.CEILING))
            val downOk = down.toDouble() == x
            val upOk = up.toDouble() == x
            val pick = when {
                downOk && upOk -> {
                    val c = exact.subtract(down).compareTo(up.subtract(exact))
                    if (c < 0 || (c == 0 && !down.unscaledValue().testBit(0))) down else up
                }
                downOk -> down
                upOk -> up
                else -> continue
            }
            val s = pick.stripTrailingZeros()
            val digits = s.unscaledValue().toString()
            return digits to (digits.length - s.scale())
        }
        error("17 digits always identify a double")
    }

    /** ToNumber(string): the StringNumericLiteral grammar ("" is 0, "0x10" is 16, " 1e3 " is 1000, "12px" is NaN). */
    fun stringToNumber(s: String): Double {
        val t = trim(s)
        if (t.isEmpty()) return 0.0
        if (t.length > 2 && t[0] == '0') {
            val radix = when (t[1]) {
                'x', 'X' -> 16
                'o', 'O' -> 8
                'b', 'B' -> 2
                else -> 0
            }
            if (radix != 0) {
                val body = t.substring(2)
                if (!body.all { asciiDigit(it, radix) >= 0 }) return Double.NaN
                return body.toBigInteger(radix).toDouble()
            }
        }
        val m = DECIMAL.matchEntire(t) ?: return Double.NaN
        if (m.groupValues[2] == "Infinity") return if (m.groupValues[1] == "-") Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
        return t.toDouble()
    }

    private val DECIMAL = Regex("""([+-]?)(Infinity|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)""")

    private fun asciiDigit(c: Char, radix: Int): Int {
        val v = when (c) {
            in '0'..'9' -> c - '0'
            in 'a'..'z' -> c - 'a' + 10
            in 'A'..'Z' -> c - 'A' + 10
            else -> return -1
        }
        return if (v < radix) v else -1
    }

    /**
     * String.prototype.toLowerCase(): Unicode default case mapping, including the context-sensitive final sigma
     * ("ΣΑΣ" → "σας"). The JDK decides final sigma by word boundaries instead, so sigma is handled here.
     */
    fun lowercase(s: String): String {
        if (s.indexOf('Σ') < 0) return s.lowercase()
        val out = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = Character.charCount(cp)
            if (cp == 0x03A3) out.append(if (isFinalSigma(s, i)) 'ς' else 'σ') else out.append(s.substring(i, i + n).lowercase())
            i += n
        }
        return out.toString()
    }

    /** Unicode Final_Sigma: preceded by a cased letter and not followed by one (case-ignorable characters skipped). */
    private fun isFinalSigma(s: String, i: Int): Boolean {
        var j = i
        var cp = 0
        while (j > 0) {
            cp = s.codePointBefore(j)
            if (!isCaseIgnorable(cp)) break
            j -= Character.charCount(cp)
        }
        if (j == 0 || !isCased(cp)) return false
        var k = i + 1
        while (k < s.length) {
            val next = s.codePointAt(k)
            if (!isCaseIgnorable(next)) return !isCased(next)
            k += Character.charCount(next)
        }
        return true
    }

    private fun isCased(cp: Int): Boolean = Character.isLowerCase(cp) || Character.isUpperCase(cp) || Character.isTitleCase(cp)

    /** General category Mn, Me, Cf, Lm, Sk, or Word_Break MidLetter, MidNumLet, Single_Quote. */
    private fun isCaseIgnorable(cp: Int): Boolean = when (Character.getType(cp).toByte()) {
        Character.NON_SPACING_MARK, Character.ENCLOSING_MARK, Character.FORMAT, Character.MODIFIER_LETTER, Character.MODIFIER_SYMBOL -> true
        else -> cp in WORD_BREAK_MID
    }

    private val WORD_BREAK_MID = setOf(
        0x27, 0x2E, 0x3A, 0xB7, 0x387, 0x55F, 0x5F4, 0x2018, 0x2019, 0x2024, 0x2027, 0xFE13, 0xFE52, 0xFE55, 0xFF07, 0xFF0E, 0xFF1A,
    )

    /** `/^prefix/i.test(s)`: without the u flag, /i folds ASCII letters only onto ASCII letters. */
    fun startsWithIgnoringAsciiCase(s: String, prefix: String): Boolean =
        s.length >= prefix.length && prefix.indices.all { asciiLower(s[it]) == asciiLower(prefix[it]) }

    /** `/needle/i.test(s)` for an ASCII needle. */
    fun containsIgnoringAsciiCase(s: String, needle: String): Boolean =
        (0..s.length - needle.length).any { start -> needle.indices.all { asciiLower(s[start + it]) == asciiLower(needle[it]) } }

    private fun asciiLower(c: Char): Char = if (c in 'A'..'Z') c + 32 else c

    // Unicode strings and UTF-8

    fun hasLoneSurrogate(s: String): Boolean {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) i += 2
            else if (c.isSurrogate()) return true
            else i++
        }
        return false
    }

    /** The USVString conversion of Web APIs (URL, URLSearchParams, TextEncoder): a lone surrogate becomes U+FFFD. */
    fun toUSV(s: String): String {
        if (!hasLoneSurrogate(s)) return s
        val out = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) {
                out.append(c).append(s[i + 1])
                i += 2
            } else {
                out.append(if (c.isSurrogate()) '�' else c)
                i++
            }
        }
        return out.toString()
    }

    /** TextEncoder.encode(). */
    fun utf8Encode(s: String): ByteArray = toUSV(s).toByteArray(Charsets.UTF_8)

    /**
     * The Encoding Standard's UTF-8 decoder: each maximal invalid subsequence becomes one U+FFFD. With [stripBom] a
     * leading byte order mark is dropped, as TextDecoder and Blob.text() do; URLSearchParams keeps it.
     */
    fun utf8Decode(bytes: ByteArray, from: Int = 0, to: Int = bytes.size, stripBom: Boolean): String {
        var i = from
        if (stripBom && to - i >= 3 && bytes[i] == 0xEF.toByte() && bytes[i + 1] == 0xBB.toByte() && bytes[i + 2] == 0xBF.toByte()) i += 3
        val out = StringBuilder(to - i)
        var needed = 0
        var seen = 0
        var cp = 0
        var lower = 0x80
        var upper = 0xBF
        while (i < to) {
            val b = bytes[i].toInt() and 0xFF
            if (needed == 0) {
                when (b) {
                    in 0x00..0x7F -> out.append(b.toChar())
                    in 0xC2..0xDF -> { needed = 1; cp = b and 0x1F }
                    in 0xE0..0xEF -> {
                        if (b == 0xE0) lower = 0xA0
                        if (b == 0xED) upper = 0x9F
                        needed = 2
                        cp = b and 0x0F
                    }
                    in 0xF0..0xF4 -> {
                        if (b == 0xF0) lower = 0x90
                        if (b == 0xF4) upper = 0x8F
                        needed = 3
                        cp = b and 0x07
                    }
                    else -> out.append('�')
                }
                i++
                continue
            }
            if (b !in lower..upper) {
                // The broken sequence is replaced, and this byte is read again as the start of a new one.
                needed = 0; seen = 0; cp = 0; lower = 0x80; upper = 0xBF
                out.append('�')
                continue
            }
            lower = 0x80; upper = 0xBF
            cp = (cp shl 6) or (b and 0x3F)
            seen++
            i++
            if (seen == needed) {
                out.appendCodePoint(cp)
                needed = 0; seen = 0; cp = 0
            }
        }
        if (needed != 0) out.append('�')
        return out.toString()
    }

    // Percent-encoding

    private fun isAlnum(b: Int): Boolean = b in 0x30..0x39 || b in 0x41..0x5A || b in 0x61..0x7A

    private const val HEX_DIGITS = "0123456789ABCDEF"

    private fun StringBuilder.appendEscaped(b: Int) {
        append('%').append(HEX_DIGITS[b shr 4]).append(HEX_DIGITS[b and 0x0F])
    }

    fun hexValue(c: Char): Int = when (c) {
        in '0'..'9' -> c - '0'
        in 'A'..'F' -> c - 'A' + 10
        in 'a'..'f' -> c - 'a' + 10
        else -> -1
    }

    /** encodeURIComponent(): everything but A-Z a-z 0-9 - _ . ! ~ * ' ( ) is %-escaped as UTF-8; a lone surrogate is a URIError. */
    fun encodeURIComponent(s: String): String {
        if (hasLoneSurrogate(s)) throw CoreError.Malformed("URI malformed")
        val out = StringBuilder(s.length)
        for (byte in s.toByteArray(Charsets.UTF_8)) {
            val b = byte.toInt() and 0xFF
            if (isAlnum(b) || b.toChar() in "-_.!~*'()") out.append(b.toChar()) else out.appendEscaped(b)
        }
        return out.toString()
    }

    /** The application/x-www-form-urlencoded serializer of URLSearchParams: space → "+", only * - . _ and alphanumerics kept. */
    fun formEncode(s: String): String {
        val out = StringBuilder(s.length)
        for (byte in utf8Encode(s)) {
            val b = byte.toInt() and 0xFF
            when {
                b == 0x20 -> out.append('+')
                isAlnum(b) || b.toChar() in "*-._" -> out.append(b.toChar())
                else -> out.appendEscaped(b)
            }
        }
        return out.toString()
    }

    /** The URL Standard's percent-decode: a "%" that does not start a valid escape is kept as it is. */
    fun percentDecode(bytes: ByteArray): ByteArray {
        val out = java.io.ByteArrayOutputStream(bytes.size)
        var i = 0
        while (i < bytes.size) {
            val b = bytes[i]
            if (b == '%'.code.toByte() && i + 2 < bytes.size) {
                val hi = hexValue((bytes[i + 1].toInt() and 0xFF).toChar())
                val lo = hexValue((bytes[i + 2].toInt() and 0xFF).toChar())
                if (hi >= 0 && lo >= 0) {
                    out.write((hi shl 4) or lo)
                    i += 3
                    continue
                }
            }
            out.write(b.toInt())
            i++
        }
        return out.toByteArray()
    }

    /** decodeURIComponent(): a broken escape or an escape that is not valid UTF-8 is an error (URIError in JS). */
    fun decodeURIComponent(s: String): String {
        val out = StringBuilder(s.length)
        fun escapedByte(at: Int): Int {
            if (at + 2 >= s.length || s[at] != '%') throw CoreError.Malformed("URI malformed")
            val hi = hexValue(s[at + 1])
            val lo = hexValue(s[at + 2])
            if (hi < 0 || lo < 0) throw CoreError.Malformed("URI malformed")
            return (hi shl 4) or lo
        }
        var k = 0
        while (k < s.length) {
            if (s[k] != '%') {
                out.append(s[k++])
                continue
            }
            val b = escapedByte(k)
            k += 3
            if (b < 0x80) {
                out.append(b.toChar())
                continue
            }
            val n = when {
                b and 0xE0 == 0xC0 -> 2
                b and 0xF0 == 0xE0 -> 3
                b and 0xF8 == 0xF0 -> 4
                else -> throw CoreError.Malformed("URI malformed")
            }
            var cp = b and (0x7F shr n)
            repeat(n - 1) {
                val next = escapedByte(k)
                if (next and 0xC0 != 0x80) throw CoreError.Malformed("URI malformed")
                cp = (cp shl 6) or (next and 0x3F)
                k += 3
            }
            val min = when (n) {
                2 -> 0x80
                3 -> 0x800
                else -> 0x10000
            }
            if (cp < min || cp > 0x10FFFF || cp in 0xD800..0xDFFF) throw CoreError.Malformed("URI malformed")
            out.appendCodePoint(cp)
        }
        return out.toString()
    }

    /** new URLSearchParams(query): "&"-separated pairs, "+" read as a space, lenient %-decoding, invalid UTF-8 → U+FFFD. */
    fun formParams(query: String): List<Pair<String, String>> =
        query.split('&').filter { it.isNotEmpty() }.map { part ->
            val eq = part.indexOf('=')
            if (eq < 0) formDecode(part) to "" else formDecode(part.substring(0, eq)) to formDecode(part.substring(eq + 1))
        }

    private fun formDecode(s: String): String = utf8Decode(percentDecode(utf8Encode(s.replace('+', ' '))), stripBom = false)

    // Base64 (atob / btoa)

    private const val BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

    /**
     * base64ToBytes() of extension/lib/base32.js: URL-safe letters mapped back, whitespace dropped, padding restored, then
     * atob()'s forgiving-base64 decode (leftover bits are discarded, a stray "=" or character is an error).
     */
    fun base64ToBytes(input: String): ByteArray {
        val s = StringBuilder(removingWhitespace(input.replace('-', '+').replace('_', '/')))
        while (s.length % 4 != 0) s.append('=')
        if (s.endsWith("==")) s.setLength(s.length - 2) else if (s.endsWith("=")) s.setLength(s.length - 1)
        if (s.length % 4 == 1) throw CoreError.Malformed("invalid base64")
        val out = java.io.ByteArrayOutputStream(s.length * 3 / 4)
        var buffer = 0
        var bits = 0
        for (c in s) {
            val v = BASE64_ALPHABET.indexOf(c)
            if (v < 0) throw CoreError.Malformed("invalid base64")
            buffer = (buffer shl 6) or v
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write(buffer ushr bits)
            }
        }
        return out.toByteArray()
    }

    /** btoa() over bytes: standard alphabet with "=" padding. */
    fun bytesToBase64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    // JSON.parse

    /**
     * JSON.parse(): strict JSON, numbers read as Doubles like JS Numbers, duplicate names keep the last value. The kotlinx
     * parser takes bare words (`otpauth`, `tru`, `01`, `NaN`) and raw control characters, so a text file with links
     * could pass for JSON there.
     */
    fun parseJson(text: String): JsonElement = JsonParser(text).document()

    private class JsonParser(private val s: String) {
        private var i = 0

        fun document(): JsonElement {
            val v = value(0)
            skipWhitespace()
            if (i != s.length) fail()
            return v
        }

        private fun fail(): Nothing = throw CoreError.Malformed("JSON")

        private fun skipWhitespace() {
            while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
        }

        private fun value(depth: Int): JsonElement {
            // No file either app writes is nested more than a few levels; a deeper one is refused instead of overflowing the stack.
            if (depth > MAX_DEPTH) fail()
            skipWhitespace()
            if (i >= s.length) fail()
            return when (s[i]) {
                '{' -> obj(depth)
                '[' -> array(depth)
                '"' -> JsonPrimitive(string())
                't' -> word("true", JsonPrimitive(true))
                'f' -> word("false", JsonPrimitive(false))
                'n' -> word("null", JsonNull)
                else -> number()
            }
        }

        private fun word(text: String, v: JsonElement): JsonElement {
            if (!s.startsWith(text, i)) fail()
            i += text.length
            return v
        }

        private fun obj(depth: Int): JsonObject {
            i++
            val members = LinkedHashMap<String, JsonElement>()
            skipWhitespace()
            if (i < s.length && s[i] == '}') {
                i++
                return JsonObject(members)
            }
            while (true) {
                skipWhitespace()
                if (i >= s.length || s[i] != '"') fail()
                val name = string()
                skipWhitespace()
                if (i >= s.length || s[i] != ':') fail()
                i++
                members[name] = value(depth + 1)
                skipWhitespace()
                if (i >= s.length) fail()
                when (s[i++]) {
                    ',' -> continue
                    '}' -> return JsonObject(members)
                    else -> fail()
                }
            }
        }

        private fun array(depth: Int): JsonArray {
            i++
            val items = ArrayList<JsonElement>()
            skipWhitespace()
            if (i < s.length && s[i] == ']') {
                i++
                return JsonArray(items)
            }
            while (true) {
                items.add(value(depth + 1))
                skipWhitespace()
                if (i >= s.length) fail()
                when (s[i++]) {
                    ',' -> continue
                    ']' -> return JsonArray(items)
                    else -> fail()
                }
            }
        }

        private fun string(): String {
            i++
            val out = StringBuilder()
            while (true) {
                if (i >= s.length) fail()
                val c = s[i++]
                when {
                    c == '"' -> return out.toString()
                    c == '\\' -> {
                        if (i >= s.length) fail()
                        when (s[i++]) {
                            '"' -> out.append('"')
                            '\\' -> out.append('\\')
                            '/' -> out.append('/')
                            'b' -> out.append('\b')
                            'f' -> out.append('\u000C')
                            'n' -> out.append('\n')
                            'r' -> out.append('\r')
                            't' -> out.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) fail()
                                var code = 0
                                repeat(4) {
                                    val h = hexValue(s[i++])
                                    if (h < 0) fail()
                                    code = (code shl 4) or h
                                }
                                out.append(code.toChar())
                            }
                            else -> fail()
                        }
                    }
                    c < ' ' -> fail()
                    else -> out.append(c)
                }
            }
        }

        private fun number(): JsonPrimitive {
            val start = i
            if (i < s.length && s[i] == '-') i++
            if (i >= s.length) fail()
            when (s[i]) {
                '0' -> i++
                in '1'..'9' -> skipDigits()
                else -> fail()
            }
            if (i < s.length && s[i] == '.') {
                i++
                if (skipDigits() == 0) fail()
            }
            if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
                i++
                if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
                if (skipDigits() == 0) fail()
            }
            return JsonPrimitive(s.substring(start, i).toDouble())
        }

        private fun skipDigits(): Int {
            val start = i
            while (i < s.length && s[i] in '0'..'9') i++
            return i - start
        }

        companion object {
            const val MAX_DEPTH = 512
        }
    }
}
