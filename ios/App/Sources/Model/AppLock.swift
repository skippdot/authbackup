import Foundation
import LocalAuthentication
import Observation
import SwiftUI

/// Face ID / Touch ID / passcode in front of the codes. On by default when the device has a passcode; codes lock again
/// after the app has spent a minute in the background, so copying a code into another app does not ask every time.
@MainActor @Observable
final class AppLock {
    static let grace: TimeInterval = 60
    private static let enabledKey = "lockEnabled"

    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    var enabled: Bool {
        didSet { defaults.set(enabled, forKey: Self.enabledKey) }
    }

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var backgroundedAt: Date?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let enabled = defaults.object(forKey: Self.enabledKey) as? Bool ?? true
        self.enabled = enabled
        isLocked = enabled && Self.canAuthenticate
    }

    /// False when the device has no passcode: then there is nothing to unlock with.
    static var canAuthenticate: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    static var biometry: LABiometryType {
        let context = LAContext()
        _ = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        return context.biometryType
    }

    func scenePhaseChanged(to phase: ScenePhase) {
        switch phase {
        case .background:
            if backgroundedAt == nil { backgroundedAt = Date() }
        case .active:
            if let since = backgroundedAt, Date().timeIntervalSince(since) > Self.grace, enabled, Self.canAuthenticate {
                isLocked = true
            }
            backgroundedAt = nil
        default:
            break
        }
    }

    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        if await Self.authenticate(reason: String(localized: "Unlock your codes")) { isLocked = false }
    }

    /// Asks for Face ID or the passcode; true on success. Used to unlock and before showing a secret.
    static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return true }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)) ?? false
    }
}
