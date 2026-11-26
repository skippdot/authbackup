import AuthBackupCore
import SwiftUI

/// What was found, before anything is saved: pick the keys to add. Keys already saved are shown, unticked.
struct ImportPreviewView: View {
    @Environment(KeyStore.self) private var store
    @Binding var batch: ImportBatch
    let onAdded: (String) -> Void
    @State private var error: String?

    var body: some View {
        List {
            if let pending = batch.pendingMigration {
                Section {
                    Label("Only \(pending.seen) of \(pending.size) QR codes of this export were scanned. Keys from the other QR codes are not here yet.",
                          systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
            }
            if !batch.candidates.isEmpty {
                Section("Keys found") {
                    ForEach($batch.candidates) { $candidate in
                        let known = store.isKnown(candidate.otp)
                        Toggle(isOn: $candidate.selected) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(candidate.otp.title ?? String(localized: "No name")).font(.headline)
                                if !candidate.otp.subtitle.isEmpty {
                                    Text(candidate.otp.subtitle).font(.subheadline).foregroundStyle(.secondary)
                                }
                                BadgeRow(badges: candidate.otp.badges)
                                if known {
                                    Text("Already saved").font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                        .disabled(known)
                    }
                }
            }
            if !batch.problems.isEmpty {
                Section("Not added") {
                    ForEach(batch.problems, id: \.self) { Text($0).font(.subheadline) }
                }
            }
        }
        .navigationTitle("Add keys")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            for i in batch.candidates.indices where store.isKnown(batch.candidates[i].otp) { batch.candidates[i].selected = false }
        }
        .safeAreaInset(edge: .bottom) {
            let count = batch.selectedAccounts.count
            Button {
                add()
            } label: {
                Text("Add \(count) keys").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(count == 0)
            .accessibilityIdentifier("addSelected")
            .padding()
            .background(.bar)
        }
        .alert("Cannot add keys", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
    }

    private func add() {
        do {
            let r = try store.add(batch.selectedAccounts, source: batch.source)
            onAdded(String(localized: "Added \(r.added) keys"))
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}
