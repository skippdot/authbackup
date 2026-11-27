package com.authbackup.core

// How a key is shown, the same way as in the extension's popup (extension/lib/ui.js).

/** The issuer, else the account; null when the key has neither (the app shows "No name"). */
val OtpAccount.title: String? get() = issuer.ifEmpty { account.ifEmpty { null } }

/** The account under the issuer; empty when the title already is the account. */
val OtpAccount.subtitle: String get() = if (issuer.isEmpty()) "" else account

/** Non-standard parameters, shown as badges so a person can see the QR code was read correctly. */
val OtpAccount.badges: List<Badge>
    get() = buildList {
        if (type == OtpType.hotp) add(Badge.Hotp)
        if (algorithm != OtpAlgorithm.SHA1) add(Badge.Algorithm(algorithm.name))
        if (digits != 6) add(Badge.Digits(digits))
        if (type == OtpType.totp && period != 30) add(Badge.Period(period))
    }

sealed class Badge {
    data object Hotp : Badge()
    data class Algorithm(val name: String) : Badge()
    data class Digits(val n: Int) : Badge()
    data class Period(val n: Int) : Badge()
}

object Display {
    /** "482913" → "482 913", "1234567" → "123 4567", as in the extension. */
    fun group(code: String): String {
        if (code.isEmpty()) return ""
        val half = code.length / 2
        return code.substring(0, half) + " " + code.substring(half)
    }
}
