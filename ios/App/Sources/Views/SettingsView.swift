import AuthBackupCore
import LocalAuthentication
import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(KeyStore.self) private var store
    @Environment(AppLock.self) private var lock
    @Environment(\.dismiss) private var dismiss
    @State private var exporting = false
    @State private var showingGoogle = false

    var body: some View {
        @Bindable var lock = lock
        NavigationStack {
            Form {
                Section {
                    Toggle(lockTitle, isOn: $lock.enabled)
                        .disabled(!AppLock.canAuthenticate)
                } header: {
                    Text("Security")
                } footer: {
                    if AppLock.canAuthenticate {
                        Text("Codes lock when AuthBackup has been in the background for a minute.")
                    } else {
                        Text("Set a passcode on this device to lock your codes.")
                    }
                }
                Section {
                    LabeledContent("Last backup", value: store.lastBackupAt?.formatted(date: .abbreviated, time: .shortened) ?? String(localized: "Never"))
                    Button { exporting = true } label: { Label("Export an encrypted backup", systemImage: "lock.doc") }
                        .accessibilityIdentifier("exportBackup")
                        .disabled(store.accounts.isEmpty)
                    Button {
                        Task {
                            if await AppLock.authenticate(reason: String(localized: "Show your keys as QR codes")) { showingGoogle = true }
                        }
                    } label: {
                        Label("Export to Google Authenticator", systemImage: "qrcode")
                    }
                    .disabled(store.accounts.isEmpty)
                } header: {
                    Text("Backup")
                } footer: {
                    Text("Keys are stored only on this device and are not included in iCloud or device backups. Keep an encrypted backup file somewhere else, such as iCloud Drive or a computer: with its password it brings your accounts back on a new device. The AuthBackup browser extension opens the same file.")
                }
                Section {
                    LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
                    Link("Privacy policy", destination: URL(string: "https://authbackup.com/privacy")!)
                    Link("Source code", destination: URL(string: "https://github.com/skippdot/authbackup")!)
                } header: {
                    Text("About")
                } footer: {
                    Text("AuthBackup has no servers, no accounts and no analytics. The app never connects to the internet.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .sheet(isPresented: $exporting) { BackupExportView() }
            .sheet(isPresented: $showingGoogle) { GoogleExportView(accounts: store.accounts.map(\.otp)) }
        }
    }

    private var lockTitle: String {
        switch AppLock.biometry {
        case .faceID: String(localized: "Lock with Face ID")
        case .touchID: String(localized: "Lock with Touch ID")
        case .opticID: String(localized: "Lock with Optic ID")
        default: String(localized: "Lock with passcode")
        }
    }
}

/// The encrypted backup file, the same format the extension writes (docs/FORMATS.md, "Encrypted backup").
struct BackupExportView: View {
    @Environment(KeyStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var confirm = ""
    @State private var document: BackupDocument?
    @State private var working = false
    @State private var error: String?

    private var problem: String? {
        if password.count < Backup.minPassword { return String(localized: "At least \(Backup.minPassword) characters.") }
        if password != confirm { return String(localized: "The passwords do not match.") }
        return nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Password", text: $password)
                        .textContentType(.newPassword)
                    SecureField("Repeat the password", text: $confirm)
                        .textContentType(.newPassword)
                } footer: {
                    Text("This password is needed to open the file. It cannot be recovered: keep it in your password manager. \(problem ?? "")")
                }
                Section {
                    Button {
                        Task { await create() }
                    } label: {
                        if working { ProgressView() } else { Text("Create the backup file (\(store.accounts.count) keys)") }
                    }
                    .disabled(problem != nil || working)
                }
            }
            .navigationTitle("Encrypted backup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .fileExporter(isPresented: Binding(get: { document != nil }, set: { if !$0 { document = nil } }),
                          document: document, contentType: .json, defaultFilename: document?.filename) { result in
                if case .success = result {
                    store.markBackedUp()
                    dismiss()
                }
            }
            .alert("Cannot create the backup", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(error ?? "") }
        }
    }

    private func create() async {
        working = true
        defer { working = false }
        let accounts = store.accounts, pw = password
        let result = await Task.detached { () -> Result<Data, CoreError> in
            do throws(CoreError) { return .success(try Backup.encryptedFile(accounts, password: pw)) } catch { return .failure(error) }
        }.value
        switch result {
        case .success(let data):
            let day = Date().formatted(.iso8601.year().month().day())
            document = BackupDocument(data: data, filename: "authbackup-\(day).encrypted")
        case .failure(let failure):
            error = ErrorText.message(failure)
        }
    }
}

struct BackupDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    var data: Data
    var filename = "authbackup.encrypted"

    init(data: Data, filename: String) {
        self.data = data
        self.filename = filename
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

/// The keys as Google Authenticator export QR codes, up to 10 keys per code, for another device or app.
struct GoogleExportView: View {
    @Environment(\.dismiss) private var dismiss
    let plan: Migration.Plan
    let accounts: [OtpAccount]

    init(accounts: [OtpAccount]) {
        self.accounts = accounts
        plan = Migration.plan(accounts)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                if plan.uris.isEmpty {
                    ContentUnavailableView("Nothing to export", systemImage: "qrcode",
                                           description: Text("None of the keys fit the Google Authenticator format."))
                } else {
                    TabView {
                        ForEach(Array(plan.uris.enumerated()), id: \.offset) { index, uri in
                            VStack(spacing: 12) {
                                if let image = QRCodes.image(for: uri) {
                                    Image(uiImage: image)
                                        .interpolation(.none)
                                        .resizable()
                                        .scaledToFit()
                                        .padding(12)
                                        .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                                        .padding(.horizontal, 24)
                                }
                                Text("QR code \(index + 1) of \(plan.uris.count), keys: \(plan.groups[index].count)")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    .tabViewStyle(.page(indexDisplayMode: .always))
                    .indexViewStyle(.page(backgroundDisplayMode: .always))
                }
                if !plan.skipped.isEmpty {
                    Text("Not included, the format cannot carry them: \(plan.skipped.map { accounts[$0.index].title ?? String(localized: "No name") }.joined(separator: ", "))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal)
                }
                Text("On the other device, open Google Authenticator, choose Transfer accounts → Import accounts and scan every QR code.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .navigationTitle("Google Authenticator")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
