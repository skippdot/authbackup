import AuthBackupCore
import SwiftUI

/// One key: rename it, see its parameters, show its QR code to move it to another app, delete it.
struct KeyDetailView: View {
    @Environment(KeyStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let item: StoredAccount
    let onMessage: (String) -> Void

    @State private var issuer: String
    @State private var account: String
    @State private var revealed = false
    @State private var confirmDelete = false
    @State private var error: String?

    init(item: StoredAccount, onMessage: @escaping (String) -> Void) {
        self.item = item
        self.onMessage = onMessage
        _issuer = State(initialValue: item.otp.issuer)
        _account = State(initialValue: item.otp.account)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Service", text: $issuer)
                    TextField("Account", text: $account)
                        .textInputAutocapitalization(.never)
                }
                Section("Parameters") {
                    LabeledContent("Type", value: item.otp.type == .totp ? "TOTP" : "HOTP")
                    LabeledContent("Algorithm", value: item.otp.algorithm.rawValue)
                    LabeledContent("Digits", value: "\(item.otp.digits)")
                    if item.otp.type == .totp {
                        LabeledContent("Period", value: String(localized: "\(item.otp.period) s"))
                    } else {
                        LabeledContent("Counter", value: "\(item.otp.counter)")
                    }
                    LabeledContent("Added", value: addedText)
                }
                Section {
                    if revealed {
                        let link = Otpauth.build(item.otp)
                        if let image = QRCodes.image(for: link) {
                            Image(uiImage: image)
                                .interpolation(.none)
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: 260)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 8)
                                .accessibilityLabel(Text("QR code of this key"))
                        }
                        Text(Base32.normalize(item.otp.secret).chunked(4))
                            .font(.body.monospaced())
                            .textSelection(.enabled)
                    } else {
                        Button {
                            Task {
                                if await AppLock.authenticate(reason: String(localized: "Show the secret key")) { revealed = true }
                            }
                        } label: {
                            Label("Show QR code and secret key", systemImage: "eye")
                        }
                    }
                } header: {
                    Text("Move to another app")
                } footer: {
                    Text("Anyone who sees this QR code or key can make your codes. Show it only to scan it into your own authenticator.")
                }
                Section {
                    Button("Delete key", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle(item.otp.title ?? String(localized: "No name"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save", action: save) }
            }
            .confirmationDialog("Delete this key?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive, action: delete)
            } message: {
                Text("Without this key you can sign in only with another copy of it or the service's recovery codes.")
            }
            .alert("Cannot save", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
    }

    private var addedText: String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = f.date(from: item.addedAt) else { return "—" }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func save() {
        do {
            try store.rename(item.id, issuer: issuer, account: account)
            dismiss()
        } catch {
            self.error = ErrorText.message(error)
        }
    }

    private func delete() {
        do {
            try store.remove(item.id)
            onMessage(String(localized: "Key deleted"))
            dismiss()
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}

extension String {
    /// "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP", easier to read out and compare.
    func chunked(_ size: Int) -> String {
        stride(from: 0, to: count, by: size).map { i in
            let start = index(startIndex, offsetBy: i)
            return String(self[start..<(index(start, offsetBy: size, limitedBy: endIndex) ?? endIndex)])
        }.joined(separator: " ")
    }
}
