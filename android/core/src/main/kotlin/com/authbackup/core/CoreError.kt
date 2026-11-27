package com.authbackup.core

/**
 * Why input was rejected. [key] is the message key of the same error in the extension
 * (extension/_locales/\*\/messages.json), so the apps and the conformance vectors name errors alike.
 *
 * These are validation results, not bugs: they carry no stack trace, so the argument-free cases can be singletons.
 */
sealed class CoreError(detail: String) : Exception(detail, null, false, false) {
    data object Base32Chars : CoreError("errBase32Chars")
    data object NotOtpauth : CoreError("errNotOtpauth")
    data class UnknownType(val type: String) : CoreError("errUnknownType: $type")
    data object NoSecret : CoreError("errNoSecret")
    data class Algorithm(val name: String) : CoreError("errAlgorithm: $name")
    data class Digits(val text: String) : CoreError("errDigits: $text")
    data class Period(val text: String) : CoreError("errPeriod: $text")
    data class Counter(val text: String) : CoreError("errCounter: $text")
    data object NotMigration : CoreError("errNotMigration")
    data object NoData : CoreError("errNoData")
    data object Truncated : CoreError("errTruncated")
    data class WireType(val wireType: Int) : CoreError("errWireType: $wireType")
    data object Md5 : CoreError("errMd5")
    data object NotOtp : CoreError("errNotOtp")
    data object VaultFormat : CoreError("errVaultFormat")
    data object WrongPassword : CoreError("wrongPassword")
    data object NotBackup : CoreError("notBackup")

    /**
     * Input that is broken below AuthBackup's own checks: an unparsable URL, a bad %-escape, invalid Base64 or JSON.
     * The extension reports these with the browser's own message; the vectors call them "other".
     */
    data class Malformed(val detail: String) : CoreError("other: $detail")

    val key: String
        get() = when (this) {
            Base32Chars -> "errBase32Chars"
            NotOtpauth -> "errNotOtpauth"
            is UnknownType -> "errUnknownType"
            NoSecret -> "errNoSecret"
            is Algorithm -> "errAlgorithm"
            is Digits -> "errDigits"
            is Period -> "errPeriod"
            is Counter -> "errCounter"
            NotMigration -> "errNotMigration"
            NoData -> "errNoData"
            Truncated -> "errTruncated"
            is WireType -> "errWireType"
            Md5 -> "errMd5"
            NotOtp -> "errNotOtp"
            VaultFormat -> "errVaultFormat"
            WrongPassword -> "wrongPassword"
            NotBackup -> "notBackup"
            is Malformed -> "other"
        }
}
