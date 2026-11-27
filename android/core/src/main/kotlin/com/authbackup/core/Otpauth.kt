package com.authbackup.core

/**
 * otpauth:// links (Google's Key Uri Format) and what a QR or the clipboard may hold. Port of extension/lib/otpauth.js.
 *
 *     otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
 */
object Otpauth {
    /** The mobile apps keep the period in a 32-bit integer; a longer one (68+ years) is no real key anyway. */
    private const val MAX_PERIOD = Int.MAX_VALUE.toDouble()

    fun parse(uri: String): OtpAccount {
        val url = WebURL.parse(JS.trim(uri))
        if (url.scheme != "otpauth") throw CoreError.NotOtpauth
        val typeName = JS.lowercase(url.hostname)
        val type = OtpType.entries.firstOrNull { it.name == typeName } ?: throw CoreError.UnknownType(typeName)

        val secret = Base32.normalize(url.queryParam("secret") ?: "")
        if (!Base32.isValid(secret)) throw CoreError.NoSecret

        // Label = "Issuer:account" or just "account"; the colon may be encoded as %3A. The issuer parameter, when present,
        // is matched as the prefix first, so an issuer that itself contains ":" does not leak into the account name.
        val label = JS.decodeURIComponent(url.pathname.removePrefix("/"))
        val issuerParam = url.queryParam("issuer") ?: ""
        var labelIssuer = ""
        var account = label
        val colon = label.indexOf(':')
        if (issuerParam.isNotEmpty() && label.startsWith("$issuerParam:")) {
            labelIssuer = issuerParam
            account = label.substring(issuerParam.length + 1)
        } else if (colon >= 0) {
            labelIssuer = label.substring(0, colon)
            account = label.substring(colon + 1)
        }

        val algorithmName = (url.queryParam("algorithm") ?: "").ifEmpty { "SHA1" }.uppercase().replaceFirst("-", "")
        val algorithm = OtpAlgorithm.entries.firstOrNull { it.name == algorithmName } ?: throw CoreError.Algorithm(algorithmName)
        val digitsText = (url.queryParam("digits") ?: "").ifEmpty { "6" }
        val digits = JS.parseInt(digitsText)?.takeIf { it == 6.0 || it == 7.0 || it == 8.0 } ?: throw CoreError.Digits(digitsText)
        val periodText = (url.queryParam("period") ?: "").ifEmpty { "30" }
        val period = JS.parseInt(periodText)
        if (period == null || !(period > 0 && period <= MAX_PERIOD)) throw CoreError.Period(periodText)
        var counter = 0.0
        if (type == OtpType.hotp) {
            val counterText = (url.queryParam("counter") ?: "").ifEmpty { "0" }
            val value = JS.parseInt(counterText)
            if (value == null || !JS.isSafeNonNegativeInteger(value)) throw CoreError.Counter(counterText)
            counter = value
        }

        val issuer = JS.trim(issuerParam)
        return OtpAccount(
            type = type, issuer = issuer.ifEmpty { JS.trim(labelIssuer) }, account = JS.trim(account), secret = secret,
            algorithm = algorithm, digits = digits.toInt(), period = period.toInt(), counter = counter.toLong(),
        )
    }

    /** Throws only for text that is not valid Unicode (a lone surrogate), as encodeURIComponent does. */
    fun build(a: OtpAccount): String {
        val label = JS.encodeURIComponent(if (a.issuer.isEmpty()) a.account else "${a.issuer}:${a.account}")
        val query = mutableListOf("secret" to a.secret)
        if (a.issuer.isNotEmpty()) query.add("issuer" to a.issuer)
        query.add("algorithm" to a.algorithm.name)
        query.add("digits" to a.digits.toString())
        if (a.type == OtpType.hotp) query.add("counter" to a.counter.toString()) else query.add("period" to a.period.toString())
        val search = query.joinToString("&") { "${JS.formEncode(it.first)}=${JS.formEncode(it.second)}" }
        return "otpauth://${a.type.name}/$label?$search"
    }

    sealed class Parsed {
        data class Otpauth(val account: OtpAccount) : Parsed()
        data class Migration(val result: com.authbackup.core.Migration.Result) : Parsed()
    }

    /** What a QR or the clipboard holds: an otpauth:// link or a Google Authenticator export. */
    fun parseAny(text: String): Parsed {
        val t = JS.trim(text)
        if (JS.startsWithIgnoringAsciiCase(t, "otpauth-migration:")) return Parsed.Migration(Migration.parse(t))
        if (JS.startsWithIgnoringAsciiCase(t, "otpauth:")) return Parsed.Otpauth(parse(t))
        throw CoreError.NotOtp
    }
}
