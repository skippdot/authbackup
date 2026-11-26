/// Why input was rejected. `key` is the message key of the same error in the extension
/// (extension/_locales/*/messages.json), so both apps and the conformance vectors name errors alike.
public enum CoreError: Error, Equatable, Sendable {
    case base32Chars
    case notOtpauth
    case unknownType(String)
    case noSecret
    case algorithm(String)
    case digits(String)
    case period(String)
    case counter(String)
    case notMigration
    case noData
    case truncated
    case wireType(Int)
    case md5
    case notOtp
    case vaultFormat
    case wrongPassword
    case notBackup
    /// Input that is broken below AuthBackup's own checks: an unparsable URL, a bad %-escape, invalid Base64 or JSON.
    /// The extension reports these with the browser's own message; the vectors call them "other".
    case malformed(String)

    public var key: String {
        switch self {
        case .base32Chars: "errBase32Chars"
        case .notOtpauth: "errNotOtpauth"
        case .unknownType: "errUnknownType"
        case .noSecret: "errNoSecret"
        case .algorithm: "errAlgorithm"
        case .digits: "errDigits"
        case .period: "errPeriod"
        case .counter: "errCounter"
        case .notMigration: "errNotMigration"
        case .noData: "errNoData"
        case .truncated: "errTruncated"
        case .wireType: "errWireType"
        case .md5: "errMd5"
        case .notOtp: "errNotOtp"
        case .vaultFormat: "errVaultFormat"
        case .wrongPassword: "wrongPassword"
        case .notBackup: "notBackup"
        case .malformed: "other"
        }
    }
}
