import AuthBackupCore
import Foundation

/// Collects keys from QR codes and links before they are saved: the import preview. Google Authenticator exports
/// come in batches of several QR codes; the batches seen so far are tracked so the person knows how many are left.
struct ImportBatch: Equatable {
    struct Candidate: Identifiable, Equatable {
        let id = UUID()
        var otp: OtpAccount
        var selected = true
    }

    var candidates: [Candidate] = []
    /// Keys that could not be read, with the reason (already localized).
    var problems: [String] = []
    /// Google Authenticator batch id → indexes seen and the batch size.
    var migrationBatches: [Int: (seen: Set<Int>, size: Int)] = [:]
    var source = "qr"

    static func == (l: ImportBatch, r: ImportBatch) -> Bool {
        l.candidates == r.candidates && l.problems == r.problems && l.source == r.source
            && l.migrationBatches.keys == r.migrationBatches.keys
    }

    var isEmpty: Bool { candidates.isEmpty && problems.isEmpty }

    /// "2 of 3" while a multi-QR export is incomplete, nil otherwise.
    var pendingMigration: (seen: Int, size: Int)? {
        migrationBatches.values.first { $0.size > 1 && $0.seen.count < $0.size }.map { ($0.seen.count, $0.size) }
    }

    /// Adds what one scanned or pasted text holds. Returns false when the text is not an AuthBackup link at all.
    @discardableResult
    mutating func add(text: String) -> Bool {
        do {
            switch try Otpauth.parseAny(text) {
            case .otpauth(let account):
                append(account)
            case .migration(let result):
                source = "google"
                let batch = result.batch
                var entry = migrationBatches[batch.id] ?? (seen: [], size: max(batch.size, 1))
                guard entry.seen.insert(batch.index).inserted else { return true }
                migrationBatches[batch.id] = entry
                result.accounts.forEach { append($0) }
                problems += result.skipped.map { "\($0.name ?? String(localized: "No name")): \(ErrorText.message($0.reason))" }
            }
            return true
        } catch .notOtp {
            return false
        } catch {
            problems.append(ErrorText.message(error))
            return true
        }
    }

    mutating func append(_ account: OtpAccount) {
        guard !candidates.contains(where: { $0.otp.dedupKey == account.dedupKey }) else { return }
        candidates.append(Candidate(otp: account))
    }

    var selectedAccounts: [OtpAccount] { candidates.filter(\.selected).map(\.otp) }
}
