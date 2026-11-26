import AuthBackupCore
import Foundation
import Observation

/// The list of keys, kept in the Keychain (see SecretStore). Mirrors the extension's lib/store.js: the same
/// deduplication, ids, `source` and `addedAt`, so backup files move between the two without loss.
@MainActor @Observable
final class KeyStore {
    private(set) var accounts: [StoredAccount] = []
    /// The Keychain could not be read. Writes are refused until it can, so a read error never turns into an empty list
    /// written over the real one.
    private(set) var loadError: String?
    private(set) var lastBackupAt: Date?

    @ObservationIgnored private let secrets: any SecretStore
    @ObservationIgnored private let defaults: UserDefaults
    private static let lastBackupKey = "lastBackupAt"

    private struct Registry: Codable {
        var version = 1
        var accounts: [StoredAccount]
    }

    struct AddResult: Equatable {
        var added = 0
        var duplicates = 0
    }

    init(secrets: any SecretStore = KeychainStore(), defaults: UserDefaults = .standard) {
        self.secrets = secrets
        self.defaults = defaults
        lastBackupAt = defaults.object(forKey: Self.lastBackupKey) as? Date
        load()
    }

    func load() {
        do {
            accounts = try secrets.read().map { try JSONDecoder().decode(Registry.self, from: $0).accounts } ?? []
            loadError = nil
        } catch {
            loadError = String(describing: error)
        }
    }

    private func save(_ list: [StoredAccount]) throws {
        if let loadError { throw StoreError.notLoaded(loadError) }
        try secrets.write(try JSONEncoder().encode(Registry(accounts: list)))
        accounts = list
    }

    enum StoreError: Error {
        case notLoaded(String)
        case noAccount
    }

    func isKnown(_ candidate: OtpAccount) -> Bool {
        accounts.contains { $0.otp.dedupKey == candidate.dedupKey }
    }

    /// Adds keys, skipping ones already saved (same type, secret, issuer and account) and repeats within the batch.
    @discardableResult
    func add(_ candidates: [OtpAccount], source: String) throws -> AddResult {
        var list = accounts
        var keys = Set(list.map(\.otp.dedupKey))
        var result = AddResult()
        for c in candidates {
            if keys.insert(c.dedupKey).inserted {
                list.append(StoredAccount(otp: c, source: source))
                result.added += 1
            } else {
                result.duplicates += 1
            }
        }
        if result.added > 0 { try save(list) }
        return result
    }

    func rename(_ id: String, issuer: String, account: String) throws {
        var list = accounts
        guard let i = list.firstIndex(where: { $0.id == id }) else { throw StoreError.noAccount }
        list[i].otp.issuer = issuer.trimmingCharacters(in: .whitespacesAndNewlines)
        list[i].otp.account = account.trimmingCharacters(in: .whitespacesAndNewlines)
        try save(list)
    }

    func remove(_ id: String) throws {
        try save(accounts.filter { $0.id != id })
    }

    func move(fromOffsets source: IndexSet, toOffset destination: Int) throws {
        var list = accounts
        list.move(fromOffsets: source, toOffset: destination)
        try save(list)
    }

    /// HOTP codes are single-use: returns the code for the current counter and advances the counter, as the extension does.
    func takeHotpCode(_ id: String) throws -> String {
        var list = accounts
        guard let i = list.firstIndex(where: { $0.id == id }) else { throw StoreError.noAccount }
        let code = try OTP.code(for: list[i].otp)
        list[i].otp.counter += 1
        try save(list)
        return code
    }

    func markBackedUp(at date: Date = Date()) {
        lastBackupAt = date
        defaults.set(date, forKey: Self.lastBackupKey)
    }
}
