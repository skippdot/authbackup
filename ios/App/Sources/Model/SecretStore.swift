import Foundation
import Security

/// Where the key list is kept. The app uses the Keychain; tests use memory.
protocol SecretStore: Sendable {
    func read() throws -> Data?
    func write(_ data: Data) throws
}

struct KeychainError: Error, CustomStringConvertible {
    let status: OSStatus
    var description: String { "Keychain error \(status)" }
}

/// One Keychain item holds the whole list. "This device only": not in iCloud Keychain, not moved to another device by
/// a device backup, readable only while the device is unlocked. Copies elsewhere are made on purpose, as encrypted
/// backup files, never as a side effect.
struct KeychainStore: SecretStore {
    var service = "com.authbackup.app"
    var account = "registry"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecUseDataProtectionKeychain as String: true]
    }

    func read() throws -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
        return out as? Data
    }

    func write(_ data: Data) throws {
        let attributes: [String: Any] = [kSecValueData as String: data,
                                         kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }
}

/// For tests and previews.
final class MemoryStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?

    init(_ data: Data? = nil) { self.data = data }

    func read() throws -> Data? { lock.withLock { data } }
    func write(_ data: Data) throws { lock.withLock { self.data = data } }
}
