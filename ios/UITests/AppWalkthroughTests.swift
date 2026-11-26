import XCTest

/// Walks through the app the way a person would and attaches a screenshot of every screen.
/// Run with ./build.sh ui (it resets the simulator's Keychain first, so every run starts with no keys).
/// The secrets are public test values (RFC 6238 and the Google Authenticator wiki), never real keys.
final class AppWalkthroughTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        // Language from the scheme's test arguments (UI_LANG=ru ./build.sh ui) or English.
        let lang = ProcessInfo.processInfo.environment["UI_LANG"] ?? "en"
        app.launchArguments += ["-AppleLanguages", "(\(lang))", "-AppleLocale", lang == "ru" ? "ru_RU" : "en_US"]
        app.launch()
    }

    private func snapshot(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// Waits until the element can be tapped: after Face ID the privacy cover is still fading out for a moment.
    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 10) {
        let hittable = expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: element)
        wait(for: [hittable], timeout: timeout)
    }

    func testWalkthrough() {
        waitHittable(app.buttons["addKeys"])
        snapshot("1-empty")

        // A key typed in by hand.
        app.buttons["addKeys"].tap()
        snapshot("2-add")
        app.buttons["manualEntry"].tap()
        app.textFields["issuer"].tap()
        app.typeText("Example")
        app.textFields["account"].tap()
        app.typeText("alice@example.com")
        let secret = app.textFields["secret"].exists ? app.textFields["secret"] : app.textViews["secret"]
        secret.tap()
        app.typeText("JBSW Y3DP EHPK 3PXP")
        snapshot("3-manual")
        app.buttons["saveManual"].tap()
        XCTAssertTrue(app.staticTexts["Example"].waitForExistence(timeout: 5))

        // Links and a Google Authenticator export from the clipboard, through the import preview.
        UIPasteboard.general.string = [
            "otpauth://totp/GitHub:octocat?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub",
            "otpauth://totp/Bank:card?secret=MFRGGZDFMZTWQ2LK&issuer=Bank&digits=8&period=60&algorithm=SHA256",
            "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        ].joined(separator: "\n")
        app.buttons["addKeys"].tap()
        app.buttons["paste"].tap()
        XCTAssertTrue(app.buttons["addSelected"].waitForExistence(timeout: 5))
        snapshot("4-preview")
        app.buttons["addSelected"].tap()
        XCTAssertTrue(app.staticTexts["GitHub"].waitForExistence(timeout: 5))
        snapshot("5-codes")

        // A tap copies the code and says so (the toast stays two seconds).
        app.staticTexts["GitHub"].tap()
        XCTAssertTrue(app.staticTexts["toast"].waitForExistence(timeout: 3), "no toast after copying")
        snapshot("6-copied")

        app.buttons["settings"].tap()
        XCTAssertTrue(app.buttons["exportBackup"].waitForExistence(timeout: 5))
        snapshot("7-settings")
        app.buttons["exportBackup"].tap()
        snapshot("8-backup")
    }
}
