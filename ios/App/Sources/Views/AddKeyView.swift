import AuthBackupCore
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Every way a key gets in: camera, an image, the clipboard, typing it, or a backup file.
struct AddKeyView: View {
    @Environment(KeyStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// Called with a summary ("Added 3 keys") when keys were saved.
    let onDone: (String) -> Void

    enum Route: Hashable { case scanner, preview, manual }

    @State private var path: [Route] = []
    @State private var batch = ImportBatch()
    @State private var photo: PhotosPickerItem?
    @State private var importingFile = false
    @State private var alert: String?
    @State private var vault: JSONValue?
    @State private var password = ""
    @State private var working = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    Button { start(.scanner) } label: { Label("Scan a QR code", systemImage: "qrcode.viewfinder") }
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label("Choose a screenshot or photo", systemImage: "photo.on.rectangle")
                    }
                    PasteButton(supportedContentTypes: [.utf8PlainText, .url, .image]) { providers in
                        Task { await paste(providers) }
                    }
                    .accessibilityIdentifier("paste")
                    Button { start(.manual) } label: { Label("Enter a key manually", systemImage: "keyboard") }
                        .accessibilityIdentifier("manualEntry")
                } footer: {
                    Text("Works with the QR code a website shows when you turn on two-factor authentication, with Google Authenticator exports (several QR codes in a row) and with the export QR codes of the AuthBackup browser extension.")
                }
                Section {
                    Button { importingFile = true } label: { Label("Restore a backup file", systemImage: "doc.badge.arrow.up") }
                } footer: {
                    Text("An encrypted backup or a JSON backup from AuthBackup, or a text file with otpauth:// links from another authenticator.")
                }
            }
            .disabled(working)
            .overlay { if working { ProgressView() } }
            .navigationTitle("Add keys")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .scanner: ScannerScreen(batch: $batch) { path = [.preview] }
                case .preview: ImportPreviewView(batch: $batch, onAdded: finish)
                case .manual: ManualEntryView(onAdded: finish)
                }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                photo = nil
                Task { await readPhoto(item) }
            }
            .fileImporter(isPresented: $importingFile, allowedContentTypes: [.json, .plainText, .text, .data]) { result in
                Task { await readFile(result) }
            }
            .alert("Cannot add keys", isPresented: Binding(get: { alert != nil }, set: { if !$0 { alert = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(alert ?? "")
            }
            .alert("Backup password", isPresented: Binding(get: { vault != nil }, set: { if !$0 { vault = nil } })) {
                SecureField("Password", text: $password)
                Button("Cancel", role: .cancel) { password = "" }
                Button("Decrypt") { Task { await decrypt() } }
            } message: {
                Text("The password that was set when this backup was made.")
            }
        }
    }

    private func start(_ route: Route) {
        batch = ImportBatch()
        path = [route]
    }

    private func finish(_ message: String) {
        onDone(message)
        dismiss()
    }

    private func showPreview(of texts: [String], source: String) {
        var next = ImportBatch()
        next.source = source
        let recognized = texts.map { next.add(text: $0) }.contains(true)
        guard recognized else {
            alert = texts.isEmpty ? String(localized: "No QR code was found.") : ErrorText.message(CoreError.notOtp)
            return
        }
        batch = next
        path = [.preview]
    }

    private func readPhoto(_ item: PhotosPickerItem) async {
        working = true
        defer { working = false }
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
            alert = String(localized: "The image cannot be opened.")
            return
        }
        showPreview(of: await QRCodes.read(from: image), source: "image")
    }

    private func paste(_ providers: [NSItemProvider]) async {
        var texts: [String] = []
        for provider in providers {
            if provider.canLoadObject(ofClass: UIImage.self), let image = await loadImage(provider) {
                texts += await QRCodes.read(from: image)
            } else if provider.canLoadObject(ofClass: String.self), let text = await loadString(provider) {
                // Several links may be pasted at once, one per line.
                texts += text.split(whereSeparator: \.isWhitespace).map(String.init)
            } else if provider.canLoadObject(ofClass: URL.self), let url = await loadURL(provider) {
                texts.append(url.absoluteString)
            }
        }
        showPreview(of: texts, source: "link")
    }

    private func loadString(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: String.self) { value, _ in continuation.resume(returning: value) }
        }
    }

    private func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { value, _ in continuation.resume(returning: value) }
        }
    }

    private func loadImage(_ provider: NSItemProvider) async -> UIImage? {
        await withCheckedContinuation { continuation in
            provider.loadObject(ofClass: UIImage.self) { value, _ in continuation.resume(returning: value as? UIImage) }
        }
    }

    // MARK: - Backup files

    private func readFile(_ result: Result<URL, Error>) async {
        guard case .success(let url) = result else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
            alert = String(localized: "The file cannot be opened.")
            return
        }
        do {
            switch try Backup.read(data) {
            case .encrypted(let v):
                password = ""
                vault = v
            case .entries(let list):
                restore(try Backup.restore(list))
            case .links(let text):
                showPreview(of: text.split(whereSeparator: \.isWhitespace).map(String.init), source: "link")
            }
        } catch {
            alert = ErrorText.message(error)
        }
    }

    private func decrypt() async {
        guard let v = vault else { return }
        let pw = password
        password = ""
        working = true
        defer { working = false }
        // PBKDF2 with 600,000 rounds takes a moment: off the main thread.
        let result = await Task.detached { () -> Result<[OtpAccount], CoreError> in
            do throws(CoreError) { return .success(try Backup.restore(Backup.open(v, password: pw))) } catch { return .failure(error) }
        }.value
        switch result {
        case .success(let accounts): restore(accounts)
        case .failure(let error): alert = ErrorText.message(error)
        }
    }

    /// A backup is restored at once, like in the extension: every key in the file, minus the ones already saved.
    private func restore(_ accounts: [OtpAccount]) {
        do {
            let r = try store.add(accounts, source: "backup")
            finish(String(localized: "Restored: \(r.added), already saved: \(r.duplicates)"))
        } catch {
            alert = ErrorText.message(error)
        }
    }
}
