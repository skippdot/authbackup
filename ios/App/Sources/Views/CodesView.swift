import AuthBackupCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The main screen: every key with its current code. A tap copies the code.
struct CodesView: View {
    @Environment(KeyStore.self) private var store
    @State private var search = ""
    @State private var sheet: Sheet?
    @State private var toast: String?
    @State private var deleting: StoredAccount?

    enum Sheet: Identifiable {
        case add, settings, edit(StoredAccount)

        var id: String {
            switch self {
            case .add: "add"
            case .settings: "settings"
            case .edit(let item): "edit-\(item.id)"
            }
        }
    }

    private var filtered: [StoredAccount] {
        let q = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return store.accounts }
        return store.accounts.filter { $0.otp.issuer.localizedStandardContains(q) || $0.otp.account.localizedStandardContains(q) }
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("AuthBackup")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { sheet = .settings } label: { Label("Settings", systemImage: "gearshape") }
                            .accessibilityIdentifier("settings")
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { sheet = .add } label: { Label("Add keys", systemImage: "plus") }
                            .accessibilityIdentifier("addKeys")
                    }
                }
        }
        .sheet(item: $sheet) { sheet in
            switch sheet {
            case .add: AddKeyView { toast = $0 }
            case .settings: SettingsView()
            case .edit(let item): KeyDetailView(item: item) { toast = $0 }
            }
        }
        .confirmationDialog("Delete this key?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible, presenting: deleting) { item in
            Button("Delete \(item.otp.title ?? String(localized: "No name"))", role: .destructive) {
                do { try store.remove(item.id) } catch { toast = ErrorText.message(error) }
            }
        } message: { _ in
            Text("Without this key you can sign in only with another copy of it or the service's recovery codes.")
        }
        .toast($toast)
    }

    @ViewBuilder private var content: some View {
        if store.loadError != nil {
            ContentUnavailableView("Keys cannot be read", systemImage: "exclamationmark.lock",
                                   description: Text("Unlock this device and open AuthBackup again. Nothing was changed."))
        } else if store.accounts.isEmpty {
            ContentUnavailableView {
                Label("No keys yet", systemImage: "key.viewfinder")
            } description: {
                Text("Scan the QR code a website shows when you turn on two-factor authentication, or bring your keys over from Google Authenticator or the AuthBackup browser extension.")
            } actions: {
                Button("Add keys") { sheet = .add }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            list
        }
    }

    private var list: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            List {
                if store.lastBackupAt == nil, search.isEmpty {
                    Section { BackupReminder { sheet = .settings } }
                }
                Section {
                    ForEach(filtered) { item in row(item, now: context.date) }
                        .onMove(perform: moveAction)
                }
            }
            .searchable(text: $search, prompt: Text("Search"))
            .overlay {
                if filtered.isEmpty, !search.isEmpty { ContentUnavailableView.search(text: search) }
            }
        }
    }

    private func row(_ item: StoredAccount, now: Date) -> some View {
        CodeRow(item: item, now: now) { copy(item, at: now) }
            .swipeActions(edge: .trailing) {
                Button(role: .destructive) { deleting = item } label: { Label("Delete", systemImage: "trash") }
                Button { sheet = .edit(item) } label: { Label("Edit", systemImage: "pencil") }
            }
            .contextMenu {
                Button { copy(item, at: Date()) } label: { Label("Copy code", systemImage: "doc.on.doc") }
                Button { sheet = .edit(item) } label: { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive) { deleting = item } label: { Label("Delete", systemImage: "trash") }
            }
    }

    /// Reordering only makes sense on the full list, not on search results.
    private var moveAction: ((IndexSet, Int) -> Void)? {
        guard search.isEmpty else { return nil }
        return { from, to in move(from, to) }
    }

    private func move(_ from: IndexSet, _ to: Int) {
        do { try store.move(fromOffsets: from, toOffset: to) } catch { toast = ErrorText.message(error) }
    }

    /// Copies the code. A TOTP code that changes in under 3 seconds would expire before it is pasted, so the next one is
    /// copied instead (as in the extension). The clipboard item stays on this device and expires after 90 seconds.
    private func copy(_ item: StoredAccount, at date: Date) {
        do {
            let code: String
            if item.otp.type == .hotp {
                code = try store.takeHotpCode(item.id)
            } else {
                var ms = date.timeIntervalSince1970 * 1000
                if OTP.secondsLeft(period: item.otp.period, nowMs: ms) < 3 { ms += 3000 }
                code = try OTP.code(for: item.otp, nowMs: ms)
            }
            UIPasteboard.general.setItems([[UTType.plainText.identifier: code]],
                                          options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(90)])
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            toast = String(localized: "Copied \(Display.group(code))")
        } catch {
            toast = ErrorText.message(error)
        }
    }
}

struct BackupReminder: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("No backup yet").font(.subheadline.weight(.semibold))
                    Text("If you lose this device, a backup file is the way back to your accounts.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
        }
        .buttonStyle(.plain)
    }
}

struct CodeRow: View {
    let item: StoredAccount
    let now: Date
    let onCopy: () -> Void

    var body: some View {
        Button(action: onCopy) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.otp.title ?? String(localized: "No name"))
                        .font(.headline)
                        .lineLimit(1)
                    if !item.otp.subtitle.isEmpty {
                        Text(item.otp.subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    BadgeRow(badges: item.otp.badges)
                }
                Spacer(minLength: 8)
                code
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Copies the code"))
    }

    @ViewBuilder private var code: some View {
        if item.otp.type == .hotp {
            Label("Get code", systemImage: "arrow.clockwise")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.tint)
        } else {
            let ms = now.timeIntervalSince1970 * 1000
            let left = OTP.secondsLeft(period: item.otp.period, nowMs: ms)
            HStack(spacing: 10) {
                Text(Display.group((try? OTP.code(for: item.otp, nowMs: ms)) ?? ""))
                    .font(.system(.title2, design: .monospaced).weight(.semibold))
                    .foregroundStyle(left <= 5 ? Color.orange : Color.primary)
                    .contentTransition(.numericText())
                Countdown(left: left, period: item.otp.period)
            }
        }
    }
}

struct Countdown: View {
    let left: Int
    let period: Int

    var body: some View {
        ZStack {
            Circle().stroke(Color.secondary.opacity(0.2), lineWidth: 3)
            Circle()
                .trim(from: 0, to: CGFloat(left) / CGFloat(max(period, 1)))
                .stroke(left <= 5 ? Color.orange : Color.accentColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(left)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .frame(width: 26, height: 26)
        .accessibilityLabel(Text("\(left) seconds left"))
    }
}

struct BadgeRow: View {
    let badges: [OtpAccount.Badge]

    var body: some View {
        if !badges.isEmpty {
            HStack(spacing: 4) {
                ForEach(badges, id: \.self) { badge in
                    Text(text(badge))
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color.secondary.opacity(0.15), in: Capsule())
                }
            }
        }
    }

    private func text(_ badge: OtpAccount.Badge) -> String {
        switch badge {
        case .hotp: "HOTP"
        case .algorithm(let name): name
        case .digits(let n): String(localized: "\(n) digits")
        case .period(let n): String(localized: "\(n) s")
        }
    }
}

extension View {
    /// A short message at the top of the screen that goes away by itself (the bottom belongs to the search field).
    func toast(_ message: Binding<String?>) -> some View {
        overlay(alignment: .top) {
            if let text = message.wrappedValue {
                Text(text)
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: text) {
                        // A newer message cancels this task: it must not clear that message on its way out.
                        do { try await Task.sleep(for: .seconds(2)) } catch { return }
                        withAnimation { message.wrappedValue = nil }
                    }
                    .accessibilityAddTraits(.isStaticText)
                    .accessibilityIdentifier("toast")
            }
        }
        .animation(.snappy, value: message.wrappedValue)
    }
}
