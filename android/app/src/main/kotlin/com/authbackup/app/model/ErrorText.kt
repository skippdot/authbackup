package com.authbackup.app.model

import android.content.res.Resources
import com.authbackup.app.R
import com.authbackup.core.CoreError

/** User-facing text for the core's errors. The wording follows the extension's messages with the same keys. */
object ErrorText {
    fun message(res: Resources, error: CoreError): String = when (error) {
        is CoreError.Base32Chars -> res.getString(R.string.key_may_contain_only_letters)
        is CoreError.NotOtpauth -> res.getString(R.string.not_otpauth_link)
        is CoreError.UnknownType -> res.getString(R.string.unknown_code_type, error.type)
        is CoreError.NoSecret -> res.getString(R.string.link_has_no_valid_secret)
        is CoreError.Algorithm -> res.getString(R.string.unsupported_algorithm, error.name)
        is CoreError.Digits -> res.getString(R.string.unsupported_number_digits, error.text)
        is CoreError.Period -> res.getString(R.string.invalid_period, error.text)
        is CoreError.Counter -> res.getString(R.string.invalid_counter, error.text)
        is CoreError.NotMigration -> res.getString(R.string.not_google_authenticator_export)
        is CoreError.NoData -> res.getString(R.string.export_link_has_no_data)
        is CoreError.Truncated, is CoreError.WireType -> res.getString(R.string.export_qr_code_damaged_incomplete)
        is CoreError.Md5 -> res.getString(R.string.md5_keys_not_supported)
        is CoreError.NotOtp -> res.getString(R.string.not_two_factor_key_google)
        is CoreError.VaultFormat -> res.getString(R.string.backup_was_made_by_newer)
        is CoreError.WrongPassword -> res.getString(R.string.wrong_password_file_damaged)
        is CoreError.NotBackup -> res.getString(R.string.not_authbackup_backup_file)
        is CoreError.Malformed -> res.getString(R.string.data_damaged_cannot_read)
    }

    fun message(res: Resources, error: Throwable): String =
        if (error is CoreError) message(res, error) else res.getString(R.string.something_went_wrong, error.toString())
}
