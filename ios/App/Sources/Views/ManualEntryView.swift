import AuthBackupCore
import SwiftUI

/// Typing a key in: for sites that show the secret as text ("can't scan the code?").
struct ManualEntryView: View {
    @Environment(KeyStore.self) private var store
    let onAdded: (String) -> Void

    @State private var issuer = ""
    @State private var account = ""
    @State private var secret = ""
    @State private var type = OtpType.totp
    @State private var algorithm = OtpAlgorithm.sha1
    @State private var digits = 6
    @State private var period = 30
    @State private var counter = 0
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                TextField("Service, for example GitHub", text: $issuer)
                    .textContentType(.organizationName)
                    .accessibilityIdentifier("issuer")
                TextField("Account, for example your email", text: $account)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.emailAddress)
                    .accessibilityIdentifier("account")
                TextField("Secret key", text: $secret, axis: .vertical)
                    .font(.body.monospaced())
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("secret")
            } footer: {
                Text("The key is the text the website shows next to the QR code, usually 16 or 32 letters and digits. Spaces do not matter.")
            }
            Section("Advanced") {
                Picker("Type", selection: $type) {
                    Text("Time-based (TOTP)").tag(OtpType.totp)
                    Text("Counter-based (HOTP)").tag(OtpType.hotp)
                }
                Picker("Algorithm", selection: $algorithm) {
                    ForEach(OtpAlgorithm.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                Picker("Digits", selection: $digits) {
                    ForEach([6, 7, 8], id: \.self) { Text("\($0)").tag($0) }
                }
                if type == .totp {
                    Stepper("Period: \(period) s", value: $period, in: 5...300, step: 5)
                } else {
                    Stepper("Counter: \(counter)", value: $counter, in: 0...1_000_000)
                }
            }
        }
        .navigationTitle("Enter a key")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Add", action: add)
                    .disabled(secret.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("saveManual")
            }
        }
        .alert("Cannot add the key", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(error ?? "") }
    }

    private func add() {
        guard Base32.isValid(secret) else {
            error = ErrorText.message(CoreError.base32Chars)
            return
        }
        let draft = OtpAccount(type: type, issuer: issuer, account: account, secret: Base32.normalize(secret),
                               algorithm: algorithm, digits: digits, period: period, counter: counter)
        do {
            // Through a link and back, so a typed key is checked exactly like a scanned one.
            let parsed = try Otpauth.parse(Otpauth.build(draft))
            let r = try store.add([parsed], source: "manual")
            onAdded(r.added > 0 ? String(localized: "Added \(r.added) keys") : String(localized: "This key is already saved"))
        } catch {
            self.error = ErrorText.message(error)
        }
    }
}
