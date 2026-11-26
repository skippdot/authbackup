import SwiftUI

@main
struct AuthBackupApp: App {
    @State private var store = KeyStore()
    @State private var lock = AppLock()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(lock)
        }
    }
}

/// Codes are not even rendered while the app is locked, and a cover hides them from the app switcher.
struct RootView: View {
    @Environment(AppLock.self) private var lock
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if lock.isLocked {
                LockView()
            } else {
                CodesView()
            }
            if scenePhase != .active, !lock.isLocked {
                PrivacyCover()
            }
        }
        .onChange(of: scenePhase) { _, phase in lock.scenePhaseChanged(to: phase) }
    }
}

struct PrivacyCover: View {
    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
        }
    }
}

struct LockView: View {
    @Environment(AppLock.self) private var lock

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "lock.shield.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("AuthBackup is locked")
                .font(.title2.weight(.semibold))
            Text("Your codes are hidden until you unlock the app.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button {
                Task { await lock.unlock() }
            } label: {
                Text("Unlock").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(lock.isAuthenticating)
        }
        .padding(24)
        .task { await lock.unlock() }
    }
}
