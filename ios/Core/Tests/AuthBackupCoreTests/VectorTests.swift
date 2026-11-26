import CryptoKit
import Foundation
import Testing
@testable import AuthBackupCore

/// tests/vectors/core.json is written by the extension's JS core (`npm run vectors`); the Swift core must agree with it
/// on every case, errors included. A failure here means the phone would read a link, an export or a backup file
/// differently from the browser.
struct Vectors: Decodable {
    struct Base32Set: Decodable {
        struct Encode: Decodable { let hex: String; let base32: String }
        struct Decode: Decodable { let input: String; let result: String?; let error: String? }
        struct Valid: Decodable { let input: String; let valid: Bool }
        let encode: [Encode], decode: [Decode], valid: [Valid]
    }
    struct OtpSet: Decodable {
        struct Totp: Decodable { let secret: String; let algorithm: OtpAlgorithm; let digits: Int; let period: Int; let at: Int64; let code: String }
        struct Hotp: Decodable { let secret: String; let algorithm: OtpAlgorithm; let digits: Int; let counter: UInt64; let code: String }
        let totp: [Totp], hotp: [Hotp]
    }
    struct OtpauthSet: Decodable {
        struct Parse: Decodable { let uri: String; let result: OtpAccount?; let error: String? }
        struct Build: Decodable { let account: OtpAccount; let uri: String }
        struct AnyText: Decodable { let text: String; let result: String?; let error: String? }
        let parse: [Parse], build: [Build], any: [AnyText]
    }
    struct Options: Decodable { let batchIndex: Int?, batchSize: Int?, batchId: Int?, maxPerQr: Int?, maxUriLength: Int? }
    struct MigrationSet: Decodable {
        struct Skip: Decodable { let name: String; let reason: String }
        struct Outcome: Decodable { let accounts: [OtpAccount]; let skipped: [Skip]; let batch: Migration.Batch }
        struct Parse: Decodable { let uri: String; let result: Outcome?; let error: String? }
        struct Build: Decodable { let accounts: [OtpAccount]; let options: Options; let uri: String }
        struct PlanSkip: Decodable { let index: Int; let reason: String }
        struct Plan: Decodable { let accounts: [OtpAccount]; let options: Options; let uris: [String]; let skipped: [PlanSkip] }
        let parse: [Parse], build: [Build], plan: [Plan]
    }
    struct KeyCase: Decodable {
        struct Loose: Decodable { let type: OtpType; let issuer: String?; let account: String?; let secret: String }
        let account: Loose, key: String
    }
    struct Restore: Decodable { let entry: JSONValue; let result: OtpAccount?; let error: String? }
    struct BackupSet: Decodable {
        struct File: Decodable { let file: JSONValue; let password: String?; let accounts: [OtpAccount]?; let error: String? }
        struct Pbkdf2: Decodable { let password: String; let salt: String; let iterations: Int; let keyHex: String }
        struct AesGcm: Decodable { let keyHex: String; let ivHex: String; let plainHex: String; let ctHex: String }
        let files: [File], pbkdf2: [Pbkdf2], aesGcm: [AesGcm]
    }

    let base32: Base32Set
    let otp: OtpSet
    let otpauth: OtpauthSet
    let migration: MigrationSet
    let accountKey: [KeyCase]
    let restore: [Restore]
    let backup: BackupSet

    static let shared: Vectors = {
        // ios/Core/Tests/AuthBackupCoreTests/VectorTests.swift → repository root
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try! Data(contentsOf: root.appendingPathComponent("tests/vectors/core.json"))
        return try! JSONDecoder().decode(Vectors.self, from: data)
    }()
}

private func hex(_ bytes: [UInt8]) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

private func bytes(hex: String) -> [UInt8] {
    var out: [UInt8] = []
    var i = hex.startIndex
    while i < hex.endIndex {
        let j = hex.index(i, offsetBy: 2)
        out.append(UInt8(hex[i..<j], radix: 16)!)
        i = j
    }
    return out
}

/// The result or the error key, so one comparison covers both outcomes.
enum Outcome<T: Equatable>: Equatable {
    case success(T)
    case failure(String)
}

private func outcome<T: Equatable>(_ body: () throws -> T) -> Outcome<T> {
    do { return .success(try body()) } catch let error as CoreError { return .failure(error.key) } catch { return .failure("unexpected \(error)") }
}

private func expected<T>(_ result: T?, _ error: String?) -> Outcome<T> {
    if let error { return .failure(error) }
    return .success(result!)
}

@Suite struct VectorTests {
    let v = Vectors.shared

    @Test func base32() {
        for c in v.base32.encode {
            #expect(Base32.encode(bytes(hex: c.hex)) == c.base32, "encode \(c.hex)")
            #expect(outcome { try hex(Base32.decode(c.base32)) } == .success(c.hex), "decode \(c.base32)")
        }
        for c in v.base32.decode {
            #expect(outcome { try hex(Base32.decode(c.input)) } == expected(c.result, c.error), "decode \(c.input.debugDescription)")
        }
        for c in v.base32.valid { #expect(Base32.isValid(c.input) == c.valid, "valid \(c.input.debugDescription)") }
    }

    @Test func totpAndHotp() throws {
        for c in v.otp.totp {
            let code = try OTP.totp(secret: c.secret, digits: c.digits, algorithm: c.algorithm, period: c.period, nowMs: Double(c.at) * 1000)
            #expect(code == c.code, "totp \(c.secret) \(c.algorithm) \(c.digits) \(c.period) at \(c.at)")
        }
        for c in v.otp.hotp {
            #expect(try OTP.hotp(secret: c.secret, counter: c.counter, digits: c.digits, algorithm: c.algorithm) == c.code, "hotp \(c.secret) \(c.counter)")
        }
    }

    @Test func otpauthLinks() {
        for c in v.otpauth.parse {
            #expect(outcome { try Otpauth.parse(c.uri) } == expected(c.result, c.error), "\(c.uri.debugDescription)")
        }
        for c in v.otpauth.build { #expect(Otpauth.build(c.account) == c.uri) }
        for c in v.otpauth.any {
            let kind = outcome { () throws -> String in
                switch try Otpauth.parseAny(c.text) {
                case .otpauth: "otpauth"
                case .migration: "migration"
                }
            }
            #expect(kind == expected(c.result, c.error), "\(c.text.debugDescription)")
        }
    }

    @Test func googleAuthenticatorExport() {
        for c in v.migration.parse {
            let got = outcome { () throws -> String in
                let r = try Migration.parse(c.uri)
                let skipped = r.skipped.map { "\($0.name ?? "noName")|\($0.reason.key)" }
                return "\(r.accounts)|\(skipped)|\(r.batch)"
            }
            let want = expected(c.result.map { r in
                "\(r.accounts)|\(r.skipped.map { "\($0.name)|\($0.reason)" })|\(r.batch)"
            }, c.error)
            #expect(got == want, "\(c.uri)")
        }
        for c in v.migration.build {
            let uri = Migration.build(c.accounts, batchIndex: c.options.batchIndex ?? 0, batchSize: c.options.batchSize ?? 1, batchId: c.options.batchId ?? 1)
            #expect(uri == c.uri)
        }
        for c in v.migration.plan {
            let p = Migration.plan(c.accounts, maxPerQr: c.options.maxPerQr ?? 10, maxUriLength: c.options.maxUriLength ?? 1200, batchId: c.options.batchId)
            #expect(p.uris == c.uris)
            #expect(p.skipped.map { "\($0.index)|\($0.reason.key)" } == c.skipped.map { "\($0.index)|\($0.reason)" })
        }
    }

    @Test func dedupKeys() {
        for c in v.accountKey {
            let a = OtpAccount(type: c.account.type, issuer: c.account.issuer ?? "", account: c.account.account ?? "", secret: c.account.secret)
            #expect(a.dedupKey == c.key)
        }
    }

    @Test func restoreEntries() {
        for c in v.restore {
            #expect(outcome { try Backup.restore(entry: c.entry) } == expected(c.result, c.error), "\(c.entry)")
        }
    }

    @Test func backupFiles() throws {
        for c in v.backup.files {
            let got = outcome { () throws -> [OtpAccount] in
                switch try Backup.read(try! JSONEncoder().encode(c.file)) {
                case .encrypted(let vault): try Backup.restore(Backup.open(vault, password: c.password ?? ""))
                case .entries(let list): try Backup.restore(list)
                case .links: throw CoreError.notBackup
                }
            }
            #expect(got == expected(c.accounts, c.error), "\(c.password ?? "plain")")
        }
    }

    @Test func pbkdf2AndAesGcm() throws {
        for c in v.backup.pbkdf2 {
            let key = try Backup.deriveKey(password: c.password, salt: JS.base64ToBytes(c.salt), iterations: c.iterations)
            #expect(key.withUnsafeBytes { hex(Array($0)) } == c.keyHex, "pbkdf2 \(c.password.debugDescription) x\(c.iterations)")
        }
        for c in v.backup.aesGcm {
            let key = SymmetricKey(data: bytes(hex: c.keyHex))
            #expect(hex(try Backup.seal(bytes(hex: c.plainHex), key: key, iv: bytes(hex: c.ivHex))) == c.ctHex)
            #expect(hex(try Backup.open(bytes(hex: c.ctHex), key: key, iv: bytes(hex: c.ivHex))) == c.plainHex)
        }
    }
}
