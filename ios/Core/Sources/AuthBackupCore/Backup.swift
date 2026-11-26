import CommonCrypto
import CryptoKit
import Foundation

/// Any JSON value. Backup files are read as JSON first and checked field by field afterwards, the way the extension
/// reads them, so a file that one app accepts the other accepts too.
public enum JSONValue: Codable, Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    /// JS truthiness.
    var truthy: Bool {
        switch self {
        case .null: false
        case .bool(let b): b
        case .number(let n): n != 0 && !n.isNaN
        case .string(let s): !s.isEmpty
        case .array, .object: true
        }
    }

    /// JS String(x).
    var jsString: String {
        switch self {
        case .null: "null"
        case .bool(let b): b ? "true" : "false"
        case .number(let n): JS.numberToString(n)
        case .string(let s): s
        case .array(let a): a.map { $0 == .null ? "" : $0.jsString }.joined(separator: ",")
        case .object: "[object Object]"
        }
    }
}

/// A key as the app stores it: the OTP fields plus the bookkeeping fields of the extension's account object
/// (`id`, `source`, `addedAt`), flat, so a backup file from either app restores in the other.
public struct StoredAccount: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var otp: OtpAccount
    /// Where the key came from: "qr", "image", "link", "manual", "google", "backup".
    public var source: String
    /// ISO 8601 with milliseconds, like Date.prototype.toISOString().
    public var addedAt: String

    public init(id: String = UUID().uuidString.lowercased(), otp: OtpAccount, source: String, addedAt: String = Backup.isoNow()) {
        self.id = id
        self.otp = otp
        self.source = source
        self.addedAt = addedAt
    }

    private enum Keys: String, CodingKey { case id, source, addedAt }

    public init(from decoder: Decoder) throws {
        otp = try OtpAccount(from: decoder)
        let c = try decoder.container(keyedBy: Keys.self)
        id = try c.decode(String.self, forKey: .id)
        source = try c.decodeIfPresent(String.self, forKey: .source) ?? "backup"
        addedAt = try c.decodeIfPresent(String.self, forKey: .addedAt) ?? ""
    }

    public func encode(to encoder: Encoder) throws {
        try otp.encode(to: encoder)
        var c = encoder.container(keyedBy: Keys.self)
        try c.encode(id, forKey: .id)
        try c.encode(source, forKey: .source)
        try c.encode(addedAt, forKey: .addedAt)
    }
}

/// Backup files, as described in docs/FORMATS.md: the plain JSON backup (version 1), the encrypted backup (version 2,
/// PBKDF2-SHA256 → AES-256-GCM, the `{ v, kdf, iv, ct }` object of extension/lib/vault.js) and text files with links.
public enum Backup {
    public static let defaultIterations = 600_000 // OWASP recommendation for PBKDF2-SHA256, as in the extension
    public static let minPassword = 8
    /// A file asking for more makes the phone hang for minutes; the extension never writes more than the default.
    static let maxIterations = 10_000_000

    public enum Content: Sendable, Equatable {
        /// The `encrypted` object of a version 2 file: needs the file's password.
        case encrypted(JSONValue)
        /// Entries of a version 1 file or of a bare JSON array, not yet validated.
        case entries([JSONValue])
        /// Not JSON, but mentions otpauth: links to show in the import preview.
        case links(String)
    }

    /// What a file holds. A text file with links is returned as `.links`; anything else that is not JSON is `notBackup`.
    public static func read(_ data: Data) throws(CoreError) -> Content {
        guard let json = try? JSONDecoder().decode(JSONValue.self, from: data) else {
            let text = String(decoding: data, as: UTF8.self)
            if text.range(of: "otpauth", options: .caseInsensitive) != nil { return .links(text) }
            throw .notBackup
        }
        if let encrypted = json["encrypted"], encrypted.truthy { return .encrypted(encrypted) }
        if case .array(let list) = json { return .entries(list) }
        if case .array(let list)? = json["accounts"] { return .entries(list) }
        throw .notBackup
    }

    /// Validates every entry like a link (backupEntryToAccount in the extension). One bad entry rejects the whole file.
    public static func restore(_ entries: [JSONValue]) throws(CoreError) -> [OtpAccount] {
        var out: [OtpAccount] = []
        for entry in entries { out.append(try restore(entry: entry)) }
        return out
    }

    /// One backup entry: missing fields get the defaults of a link, then the entry is written as an otpauth:// link
    /// and parsed again, exactly as the extension does it.
    public static func restore(entry: JSONValue) throws(CoreError) -> OtpAccount {
        var m: [String: JSONValue] = ["type": .string("totp"), "algorithm": .string("SHA1"), "digits": .number(6), "period": .number(30)]
        if case .object(let o) = entry { m.merge(o) { _, new in new } }
        // A missing secret would be written as the text "undefined", which is valid Base32: refused, as in the extension.
        guard let secret = m["secret"], secret != .null else { throw .noSecret }
        let account = m["account"].flatMap { $0 == .null ? nil : $0.jsString } ?? ""
        let issuer = m["issuer"].flatMap { $0.truthy ? $0.jsString : nil }
        let label = JS.encodeURIComponent(issuer.map { "\($0):\(account)" } ?? account)
        let type = m["type"]?.jsString ?? "undefined"
        var query = [("secret", secret.jsString)]
        if let issuer { query.append(("issuer", issuer)) }
        query.append(("algorithm", m["algorithm"]?.jsString ?? "undefined"))
        query.append(("digits", m["digits"]?.jsString ?? "undefined"))
        if m["type"] == .string("hotp") {
            query.append(("counter", m["counter"].flatMap { $0.truthy ? $0.jsString : nil } ?? "0"))
        } else {
            query.append(("period", m["period"]?.jsString ?? "undefined"))
        }
        let search = query.map { "\(JS.formEncode($0.0))=\(JS.formEncode($0.1))" }.joined(separator: "&")
        return try Otpauth.parse("otpauth://\(type)/\(label)?\(search)")
    }

    // MARK: - Encryption

    /// PBKDF2-HMAC-SHA256 → a 256-bit AES key.
    public static func deriveKey(password: String, salt: [UInt8], iterations: Int) throws(CoreError) -> SymmetricKey {
        guard iterations >= 1, iterations <= maxIterations else { throw .malformed("iterations") }
        let pw = Array(password.utf8)
        var out = [UInt8](repeating: 0, count: 32)
        let status = pw.withUnsafeBufferPointer { p in
            p.withMemoryRebound(to: Int8.self) { pwChars in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), pwChars.baseAddress, pw.count, salt, salt.count,
                                     CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, out.count)
            }
        }
        guard status == kCCSuccess else { throw .malformed("PBKDF2 failed") }
        return SymmetricKey(data: out)
    }

    /// AES-256-GCM in the Web Crypto layout: ciphertext followed by the 16-byte tag.
    public static func seal(_ plain: [UInt8], key: SymmetricKey, iv: [UInt8]) throws(CoreError) -> [UInt8] {
        do {
            let box = try AES.GCM.seal(plain, using: key, nonce: try AES.GCM.Nonce(data: iv))
            return Array(box.ciphertext) + Array(box.tag)
        } catch {
            throw .malformed("AES-GCM failed")
        }
    }

    /// A wrong key and a changed ciphertext both fail the tag check: `wrongPassword`, never garbage.
    public static func open(_ ct: [UInt8], key: SymmetricKey, iv: [UInt8]) throws(CoreError) -> [UInt8] {
        guard ct.count >= 16 else { throw .wrongPassword }
        do {
            let box = try AES.GCM.SealedBox(nonce: try AES.GCM.Nonce(data: iv), ciphertext: ct.dropLast(16), tag: ct.suffix(16))
            return Array(try AES.GCM.open(box, using: key))
        } catch {
            throw .wrongPassword
        }
    }

    /// Opens the `encrypted` object of a version 2 file and returns the entries inside, not yet validated.
    public static func open(_ vault: JSONValue, password: String) throws(CoreError) -> [JSONValue] {
        guard vault["v"] == .number(1), vault["kdf"]?["name"] == .string("PBKDF2-SHA256") else { throw .vaultFormat }
        guard case .string(let saltText)? = vault["kdf"]?["salt"] else { throw .malformed("salt") }
        let iterations: Double? = switch vault["kdf"]?["iterations"] {
        case .number(let n)?: n
        case .string(let s)?: Double(JS.trim(s))
        default: nil
        }
        guard let iterations, iterations.isFinite, let rounds = Int(exactly: iterations.rounded(.towardZero)) else { throw .malformed("iterations") }
        let key = try deriveKey(password: password, salt: try JS.base64ToBytes(saltText), iterations: rounds)
        // In the extension the IV and ciphertext are decoded inside the decrypt call: damage there is a wrong password too.
        guard case .string(let ivText)? = vault["iv"], case .string(let ctText)? = vault["ct"],
              let iv = try? JS.base64ToBytes(ivText), let ct = try? JS.base64ToBytes(ctText) else { throw .wrongPassword }
        let plain = try open(ct, key: key, iv: iv)
        guard let data = try? JSONDecoder().decode(JSONValue.self, from: Data(plain)) else { throw .malformed("JSON") }
        guard case .array(let accounts)? = data["accounts"] else { throw .malformed("accounts") }
        return accounts
    }

    private static func randomBytes(_ count: Int) -> [UInt8] {
        var g = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: 0...255, using: &g) }
    }

    // MARK: - Writing

    private struct VaultFile: Encodable {
        struct KDF: Encodable { let name: String; let iterations: Int; let salt: String }
        struct Vault: Encodable { let v: Int; let kdf: KDF; let iv: String; let ct: String }
        let app = "authbackup"
        let version = 2
        let exportedAt: String
        let count: Int
        let encrypted: Vault
    }

    private struct PlainFile: Encodable {
        let app = "authbackup"
        let version = 1
        let exportedAt: String
        let accounts: [StoredAccount]
    }

    private struct Payload: Encodable { let accounts: [StoredAccount] }

    private static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }

    /// `authbackup-<date>.encrypted.json`, the same file the extension writes.
    public static func encryptedFile(_ accounts: [StoredAccount], password: String, iterations: Int = defaultIterations,
                                     now: Date = Date()) throws(CoreError) -> Data {
        let salt = randomBytes(16), iv = randomBytes(12)
        let key = try deriveKey(password: password, salt: salt, iterations: iterations)
        guard let plain = try? encoder().encode(Payload(accounts: accounts)) else { throw .malformed("JSON") }
        let ct = try seal(Array(plain), key: key, iv: iv)
        let file = VaultFile(exportedAt: isoString(now), count: accounts.count, encrypted: .init(
            v: 1, kdf: .init(name: "PBKDF2-SHA256", iterations: iterations, salt: JS.bytesToBase64(salt)),
            iv: JS.bytesToBase64(iv), ct: JS.bytesToBase64(ct)))
        guard let data = try? encoder().encode(file) else { throw .malformed("JSON") }
        return data
    }

    /// `authbackup-<date>.json`: the keys in plain text.
    public static func plainFile(_ accounts: [StoredAccount], now: Date = Date()) -> Data {
        (try? encoder().encode(PlainFile(exportedAt: isoString(now), accounts: accounts))) ?? Data()
    }

    /// One otpauth:// link per line, for other authenticators.
    public static func otpauthText(_ accounts: [StoredAccount]) -> String {
        accounts.map { Otpauth.build($0.otp) + "\n" }.joined()
    }

    /// Date.prototype.toISOString(): UTC with milliseconds.
    public static func isoString(_ date: Date) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: date)
    }

    public static func isoNow() -> String { isoString(Date()) }
}
