// swift-tools-version: 6.0
// AuthBackupCore: the OTP core of the iOS app (Base32, HOTP/TOTP, otpauth:// links, the Google Authenticator export,
// backup files). It is a port of the extension's extension/lib and is checked against tests/vectors/core.json, which
// the extension's JS core generates (`npm run vectors`). No UIKit here, so `swift test` runs on a Mac in seconds.
import PackageDescription

let package = Package(
    name: "AuthBackupCore",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [.library(name: "AuthBackupCore", targets: ["AuthBackupCore"])],
    targets: [
        .target(name: "AuthBackupCore"),
        .testTarget(name: "AuthBackupCoreTests", dependencies: ["AuthBackupCore"]),
    ]
)
