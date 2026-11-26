import CryptoKit
import Foundation

public enum OtpType: String, Codable, Sendable, Hashable {
    case totp, hotp
}

public enum OtpAlgorithm: String, Codable, Sendable, Hashable, CaseIterable {
    case sha1 = "SHA1", sha256 = "SHA256", sha512 = "SHA512"
}

/// The OTP fields of one key, as in the extension's account object (docs/FORMATS.md, "Account object").
public struct OtpAccount: Codable, Sendable, Hashable {
    public var type: OtpType
    public var issuer: String
    public var account: String
    /// Upper-case Base32 without padding.
    public var secret: String
    public var algorithm: OtpAlgorithm
    public var digits: Int
    /// Seconds; used by TOTP only.
    public var period: Int
    /// Used by HOTP only.
    public var counter: Int

    public init(type: OtpType = .totp, issuer: String = "", account: String = "", secret: String,
                algorithm: OtpAlgorithm = .sha1, digits: Int = 6, period: Int = 30, counter: Int = 0) {
        self.type = type
        self.issuer = issuer
        self.account = account
        self.secret = secret
        self.algorithm = algorithm
        self.digits = digits
        self.period = period
        self.counter = counter
    }

    /// The deduplication key of extension/lib/otpauth.js: the same secret under the same label is one key.
    public var dedupKey: String {
        "\(type.rawValue)|\(Base32.normalize(secret))|\(JS.lowercase(issuer))|\(JS.lowercase(account))"
    }
}

/// HOTP (RFC 4226) and TOTP (RFC 6238). Port of extension/lib/totp.js.
public enum OTP {
    public static func hotp(secret: String, counter: UInt64, digits: Int = 6, algorithm: OtpAlgorithm = .sha1) throws(CoreError) -> String {
        let key = SymmetricKey(data: try Base32.decode(secret))
        var big = counter.bigEndian
        let message = withUnsafeBytes(of: &big) { Data($0) }
        let mac: [UInt8] = switch algorithm {
        case .sha1: Array(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        case .sha256: Array(HMAC<SHA256>.authenticationCode(for: message, using: key))
        case .sha512: Array(HMAC<SHA512>.authenticationCode(for: message, using: key))
        }
        // Dynamic truncation (RFC 4226 §5.3): the low 4 bits of the last byte are the offset.
        let offset = Int(mac[mac.count - 1] & 0x0F)
        let bin = UInt32(mac[offset] & 0x7F) << 24 | UInt32(mac[offset + 1]) << 16 | UInt32(mac[offset + 2]) << 8 | UInt32(mac[offset + 3])
        var modulus: UInt32 = 1
        for _ in 0..<digits { modulus = modulus &* 10 }
        let code = digits >= 10 ? bin : bin % modulus
        return String(code).leftPadded(to: digits)
    }

    /// Time step for a moment in milliseconds since 1970, computed like Math.floor(nowMs / 1000 / period).
    public static func timeStep(period: Int = 30, nowMs: Double) -> UInt64 {
        UInt64(max(0, (nowMs / 1000 / Double(period)).rounded(.down)))
    }

    public static func secondsLeft(period: Int = 30, nowMs: Double) -> Int {
        let seconds = Int64((nowMs / 1000).rounded(.down))
        return period - Int(seconds % Int64(period))
    }

    public static func totp(secret: String, digits: Int = 6, algorithm: OtpAlgorithm = .sha1, period: Int = 30, nowMs: Double) throws(CoreError) -> String {
        try hotp(secret: secret, counter: timeStep(period: period, nowMs: nowMs), digits: digits, algorithm: algorithm)
    }

    /// The current code of a key: TOTP from the clock, HOTP from its counter.
    public static func code(for a: OtpAccount, nowMs: Double = Date().timeIntervalSince1970 * 1000) throws(CoreError) -> String {
        switch a.type {
        case .totp: try totp(secret: a.secret, digits: a.digits, algorithm: a.algorithm, period: a.period, nowMs: nowMs)
        case .hotp: try hotp(secret: a.secret, counter: UInt64(max(0, a.counter)), digits: a.digits, algorithm: a.algorithm)
        }
    }
}
