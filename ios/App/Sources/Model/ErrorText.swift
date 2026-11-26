import AuthBackupCore
import Foundation

/// User-facing text for the core's errors. The wording follows the extension's messages with the same keys.
enum ErrorText {
    static func message(_ error: CoreError) -> String {
        switch error {
        case .base32Chars: String(localized: "The key may contain only the letters A–Z and the digits 2–7.")
        case .notOtpauth: String(localized: "This is not an otpauth:// link.")
        case .unknownType(let type): String(localized: "Unknown code type: \(type).")
        case .noSecret: String(localized: "The link has no valid secret key.")
        case .algorithm(let name): String(localized: "Unsupported algorithm: \(name).")
        case .digits(let value): String(localized: "Unsupported number of digits: \(value).")
        case .period(let value): String(localized: "Invalid period: \(value).")
        case .counter(let value): String(localized: "Invalid counter: \(value).")
        case .notMigration: String(localized: "This is not a Google Authenticator export.")
        case .noData: String(localized: "The export link has no data.")
        case .truncated, .wireType: String(localized: "The export QR code is damaged or incomplete.")
        case .md5: String(localized: "MD5 keys are not supported.")
        case .notOtp: String(localized: "This is not a two-factor key or a Google Authenticator export.")
        case .vaultFormat: String(localized: "This backup was made by a newer version and cannot be opened here.")
        case .wrongPassword: String(localized: "Wrong password, or the file is damaged.")
        case .notBackup: String(localized: "This is not an AuthBackup backup file.")
        case .malformed: String(localized: "The data is damaged and cannot be read.")
        }
    }

    static func message(_ error: any Error) -> String {
        if let core = error as? CoreError { return message(core) }
        return String(localized: "Something went wrong: \(String(describing: error))")
    }
}
