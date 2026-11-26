import AuthBackupCore
import Foundation
import Testing
@testable import AuthBackup

/// The key list on top of a memory store: the same deduplication as the extension, and no write over a list that
/// could not be read.
@MainActor
struct KeyStoreTests {
    private func store(_ secrets: MemoryStore = MemoryStore()) -> KeyStore {
        KeyStore(secrets: secrets, defaults: UserDefaults(suiteName: UUID().uuidString)!)
    }

    private let alice = OtpAccount(issuer: "Example", account: "alice@example.com", secret: "JBSWY3DPEHPK3PXP")

    @Test func addsAndSkipsDuplicates() throws {
        let s = store()
        var copy = alice
        copy.issuer = "EXAMPLE" // the dedup key ignores case in names
        #expect(try s.add([alice, copy], source: "qr") == .init(added: 1, duplicates: 1))
        #expect(try s.add([alice], source: "qr") == .init(added: 0, duplicates: 1))
        #expect(s.accounts.count == 1)
        #expect(s.accounts[0].source == "qr")
    }

    @Test func persistsAcrossLaunches() throws {
        let secrets = MemoryStore()
        try store(secrets).add([alice], source: "manual")
        let reopened = store(secrets)
        #expect(reopened.accounts.map(\.otp) == [alice])
    }

    @Test func refusesToWriteOverAnUnreadableList() throws {
        let s = store(MemoryStore(Data("not json".utf8)))
        #expect(s.loadError != nil)
        #expect(throws: KeyStore.StoreError.self) { try s.add([alice], source: "qr") }
    }

    @Test func hotpAdvancesTheCounter() throws {
        let s = store()
        let hotp = OtpAccount(type: .hotp, issuer: "H", account: "h", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
        try s.add([hotp], source: "qr")
        let id = s.accounts[0].id
        #expect(try s.takeHotpCode(id) == "755224") // RFC 4226, counter 0
        #expect(try s.takeHotpCode(id) == "287082") // counter 1
        #expect(s.accounts[0].otp.counter == 2)
    }

    @Test func encryptedBackupRoundTrip() throws {
        let s = store()
        try s.add([alice], source: "qr")
        let file = try Backup.encryptedFile(s.accounts, password: "correct horse", iterations: 1000)
        guard case .encrypted(let vault) = try Backup.read(file) else { Issue.record("not an encrypted file"); return }
        #expect(try Backup.restore(Backup.open(vault, password: "correct horse")) == [alice])
        #expect(throws: CoreError.wrongPassword) { try Backup.open(vault, password: "wrong horse") }
    }

    @Test func importBatchCollectsAGoogleExport() {
        var batch = ImportBatch()
        let other = OtpAccount(issuer: "Other", account: "bob", secret: "MFRGGZDFMZTWQ2LK")
        let first = Migration.build([alice], batchIndex: 0, batchSize: 2, batchId: 7)
        let second = Migration.build([other], batchIndex: 1, batchSize: 2, batchId: 7)
        // add(text:) mutates the batch, so it is called outside #expect.
        var read = batch.add(text: first)
        #expect(read)
        #expect(batch.pendingMigration?.seen == 1)
        read = batch.add(text: first) // the same QR again changes nothing
        #expect(read && batch.candidates.count == 1)
        read = batch.add(text: second)
        #expect(read)
        #expect(batch.pendingMigration == nil)
        #expect(batch.selectedAccounts == [alice, other])
        #expect(batch.source == "google")
        read = batch.add(text: "https://example.com")
        #expect(!read)
    }
}
