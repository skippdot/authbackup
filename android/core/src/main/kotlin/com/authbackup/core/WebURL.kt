package com.authbackup.core

/**
 * The part of the WHATWG URL parser (what `new URL()` does in the browser) that otpauth:// and otpauth-migration://
 * links reach: non-special schemes, an opaque host, a path with dot segments, a query. java.net.URI follows
 * RFC 3986 instead and disagrees on exactly the links people paste: unescaped spaces, "+" in the query, "../".
 */
internal class WebURL private constructor(
    /** Lower-case scheme without ":" (url.protocol minus the colon). */
    val scheme: String,
    /** url.hostname: "" when the link has no "//" authority or an empty one. */
    val hostname: String,
    /** url.pathname with dot segments resolved, escapes left as written ("/Example:alice"). */
    val pathname: String,
    /** url.search without "?", escapes left as written. */
    val query: String,
) {
    /** url.searchParams.get(name): the first value, or null. */
    fun queryParam(name: String): String? = JS.formParams(query).firstOrNull { it.first == name }?.second

    companion object {
        private val special = setOf("http", "https", "ws", "wss", "ftp", "file")

        private fun invalid(): Nothing = throw CoreError.Malformed("Invalid URL")

        fun parse(input: String): WebURL {
            // The URL API takes a USVString; leading and trailing C0 controls and spaces are stripped, tabs and
            // newlines removed anywhere.
            val s = JS.toUSV(input).trim { it <= ' ' }.filterNot { it == '\t' || it == '\n' || it == '\r' }

            val colon = s.indexOf(':')
            if (colon <= 0 || !isAlpha(s[0]) || !(1 until colon).all { s[it].let { c -> isAlpha(c) || isDigit(c) || c in "+-." } }) invalid()
            val scheme = s.substring(0, colon).lowercase()
            var rest = s.substring(colon + 1)

            // Everything after "#" is the fragment, which no AuthBackup link uses.
            rest.indexOf('#').let { if (it >= 0) rest = rest.substring(0, it) }
            var query = ""
            rest.indexOf('?').let {
                if (it >= 0) {
                    query = rest.substring(it + 1)
                    rest = rest.substring(0, it)
                }
            }
            // Special schemes (http:, ...) only need to be told apart from otpauth:, so the rest of them is not parsed.
            if (scheme in special) return WebURL(scheme, "", "", query)

            if (rest.startsWith("//")) {
                val end = rest.indexOf('/', 2).let { if (it < 0) rest.length else it }
                return WebURL(scheme, host(rest.substring(2, end)), resolveDots(rest.substring(end)), query)
            }
            // "otpauth:totp/x": an opaque path, no host.
            if (!rest.startsWith("/")) return WebURL(scheme, "", rest, query)
            return WebURL(scheme, "", resolveDots(rest), query)
        }

        private fun isAlpha(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z'
        private fun isDigit(c: Char): Boolean = c in '0'..'9'

        /**
         * The authority of a non-special URL: user info and port dropped, the port checked, then the opaque host
         * (an IPv6 address in brackets, or text without forbidden characters, non-ASCII %-escaped as url.hostname shows it).
         */
        private fun host(authority: String): String {
            val at = authority.lastIndexOf('@')
            val hostPort = authority.substring(at + 1)
            if (at >= 0 && hostPort.isEmpty()) invalid() // "user@" and no host
            var colon = -1
            var inBrackets = false
            for ((i, c) in hostPort.withIndex()) {
                if (c == '[') inBrackets = true else if (c == ']') inBrackets = false else if (c == ':' && !inBrackets) {
                    colon = i
                    break
                }
            }
            val host = if (colon >= 0) hostPort.substring(0, colon) else hostPort
            if (colon >= 0) {
                if (host.isEmpty()) invalid()
                val port = hostPort.substring(colon + 1)
                if (!port.all(::isDigit)) invalid()
                val digits = port.trimStart('0')
                if (digits.length > 5 || (digits.isNotEmpty() && digits.toInt() > 65535)) invalid()
            }
            if (host.startsWith("[")) {
                if (!host.endsWith("]")) invalid()
                return "[" + ipv6(host.substring(1, host.length - 1)) + "]"
            }
            if (host.any { it in FORBIDDEN_HOST }) invalid()
            val out = StringBuilder()
            var i = 0
            while (i < host.length) {
                val cp = host.codePointAt(i)
                val n = Character.charCount(cp)
                if (cp < 0x20 || cp > 0x7E) {
                    for (b in host.substring(i, i + n).toByteArray(Charsets.UTF_8)) {
                        val v = b.toInt() and 0xFF
                        out.append('%').append(HEX[v shr 4]).append(HEX[v and 0x0F])
                    }
                } else {
                    out.append(host[i])
                }
                i += n
            }
            return out.toString()
        }

        private const val FORBIDDEN_HOST = "\u0000\t\n\r #/:<>?@[\\]^|"
        private const val HEX = "0123456789ABCDEF"

        /** The URL Standard's IPv6 parser and serializer ("[0:0::1]" → "::1"). */
        private fun ipv6(input: String): String {
            val address = IntArray(8)
            var piece = 0
            var compress = -1
            var p = 0
            fun c(at: Int = p): Char? = input.getOrNull(at)
            if (c() == ':') {
                if (c(p + 1) != ':') invalid()
                p += 2
                piece++
                compress = piece
            }
            while (c() != null) {
                if (piece == 8) invalid()
                if (c() == ':') {
                    if (compress != -1) invalid()
                    p++
                    piece++
                    compress = piece
                    continue
                }
                var value = 0
                var length = 0
                while (length < 4 && c()?.let { JS.hexValue(it) >= 0 } == true) {
                    value = value * 0x10 + JS.hexValue(c()!!)
                    p++
                    length++
                }
                if (c() == '.') {
                    if (length == 0) invalid()
                    p -= length
                    if (piece > 6) invalid()
                    var numbersSeen = 0
                    while (c() != null) {
                        if (numbersSeen > 0) {
                            if (c() == '.' && numbersSeen < 4) p++ else invalid()
                        }
                        if (c()?.let(::isDigit) != true) invalid()
                        var ipv4Piece = -1
                        while (c()?.let(::isDigit) == true) {
                            val number = c()!! - '0'
                            ipv4Piece = when (ipv4Piece) {
                                -1 -> number
                                0 -> invalid()
                                else -> ipv4Piece * 10 + number
                            }
                            if (ipv4Piece > 255) invalid()
                            p++
                        }
                        address[piece] = address[piece] * 0x100 + ipv4Piece
                        numbersSeen++
                        if (numbersSeen == 2 || numbersSeen == 4) piece++
                    }
                    if (numbersSeen != 4) invalid()
                    break
                } else if (c() == ':') {
                    p++
                    if (c() == null) invalid()
                } else if (c() != null) {
                    invalid()
                }
                address[piece] = value
                piece++
            }
            if (compress != -1) {
                var swaps = piece - compress
                piece = 7
                while (piece != 0 && swaps > 0) {
                    val t = address[piece]
                    address[piece] = address[compress + swaps - 1]
                    address[compress + swaps - 1] = t
                    piece--
                    swaps--
                }
            } else if (piece != 8) {
                invalid()
            }
            // Serialize: the first longest run of two or more zero pieces becomes "::".
            var best = -1
            var bestLength = 1
            var run = 0
            for (k in 0..8) {
                if (k < 8 && address[k] == 0) run++ else {
                    if (run > bestLength) {
                        best = k - run
                        bestLength = run
                    }
                    run = 0
                }
            }
            val out = StringBuilder()
            var ignoreZero = false
            for (k in 0 until 8) {
                if (ignoreZero && address[k] == 0) continue
                ignoreZero = false
                if (k == best) {
                    out.append(if (k == 0) "::" else ":")
                    ignoreZero = true
                    continue
                }
                out.append(address[k].toString(16))
                if (k != 7) out.append(':')
            }
            return out.toString()
        }

        /** "." and ".." segments (also written as %2e) are resolved the way the browser does: "/a/./b/../c" → "/a/c". */
        private fun resolveDots(path: String): String {
            if (path.isEmpty()) return ""
            val segments = path.substring(1).split('/')
            val out = ArrayList<String>()
            for ((i, segment) in segments.withIndex()) {
                val last = i == segments.size - 1
                when (segment.replace("%2E", "%2e")) {
                    "..", ".%2e", "%2e.", "%2e%2e" -> {
                        if (out.isNotEmpty()) out.removeAt(out.size - 1)
                        if (last) out.add("")
                    }
                    ".", "%2e" -> if (last) out.add("")
                    else -> out.add(segment)
                }
            }
            return "/" + out.joinToString("/")
        }
    }
}
