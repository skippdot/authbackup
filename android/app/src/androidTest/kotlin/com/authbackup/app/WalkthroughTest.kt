package com.authbackup.app

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Walks through the app the way a person would and saves a screenshot of every screen. Run with ./build.sh ui: it
 * clears the app's data first (every run starts with no keys), sets a test PIN on the script's own emulator and
 * records a video. The secrets are public test values (RFC 6238, the Google Authenticator wiki) or plain words in
 * Base32, never real keys. The same steps as ios/UITests/AppWalkthroughTests.swift.
 */
@RunWith(AndroidJUnit4::class)
class WalkthroughTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val pin: String? = InstrumentationRegistry.getArguments().getString("pin")

    private fun snapshot(name: String) {
        compose.waitForIdle()
        device.waitForIdle() // composed is not yet drawn: let the last frame reach the screen
        val dir = File(compose.activity.getExternalFilesDir(null), "walkthrough").apply { mkdirs() }
        device.takeScreenshot(File(dir, "$name.png"))
    }

    private fun waitFor(tag: String) = waitForNode(hasTestTag(tag))

    private fun waitForText(text: String) = waitForNode(hasText(text))

    private fun waitForNode(matcher: SemanticsMatcher) {
        try {
            compose.waitUntil(10_000) { compose.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty() }
        } catch (e: ComposeTimeoutException) {
            throw AssertionError("not on screen: ${matcher.description}", e)
        }
    }

    private fun string(id: Int, vararg args: Any) = compose.activity.getString(id, *args)

    /** The system's screen lock prompt, answered with the script's test PIN (its own emulator, never a real device). */
    private fun unlock() {
        val code = pin ?: return
        // The lock screen asks for the screen lock from a LaunchedEffect; the v2 test rule runs effects only while the
        // test lets Compose work, so let it before waiting outside Compose for the system prompt.
        compose.waitForIdle()
        val field = device.wait(Until.findObject(By.res("com.android.systemui", "lockPassword")), 10_000)
            ?: throw AssertionError("the screen lock prompt did not appear")
        snapshot("0-locked")
        field.text = code
        device.pressEnter()
    }

    @Test
    fun walkthrough() {
        unlock()
        waitFor("addKeys")
        snapshot("1-empty")

        // A key typed in by hand.
        compose.onNodeWithTag("addKeys").performClick()
        waitFor("manualEntry")
        snapshot("2-add")
        compose.onNodeWithTag("manualEntry").performClick()
        compose.onNodeWithTag("issuer").performTextInput("Example")
        compose.onNodeWithTag("account").performTextInput("alice@example.com")
        compose.onNodeWithTag("secret").performTextInput("JBSW Y3DP EHPK 3PXP")
        snapshot("3-manual")
        compose.onNodeWithTag("saveManual").performClick()
        waitForText("Example")

        // Links from the clipboard, through the import preview (one is already saved and stays unticked).
        val links = listOf(
            "otpauth://totp/GitHub:octocat?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=GitHub",
            "otpauth://totp/Bank:card?secret=MFRGGZDFMZTWQ2LK&issuer=Bank&digits=8&period=60&algorithm=SHA256",
            "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        ).joinToString("\n")
        instrumentation.runOnMainSync {
            compose.activity.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("links", links))
        }
        compose.onNodeWithTag("addKeys").performClick()
        waitFor("paste")
        compose.onNodeWithTag("paste").performClick()
        waitFor("addSelected")
        waitForText(string(R.string.already_saved))
        snapshot("4-preview")
        compose.onNodeWithTag("addSelected").performClick()
        waitForText("GitHub")
        snapshot("5-codes")

        // A tap copies the code and says so.
        compose.onNodeWithText("GitHub").performClick()
        waitForNode(hasText(string(R.string.copied, "").trim(), substring = true))
        snapshot("6-copied")

        compose.onNodeWithTag("settings").performClick()
        waitFor("exportBackup")
        snapshot("7-settings")
        compose.onNodeWithTag("exportBackup").performClick()
        waitFor("createBackup")
        snapshot("8-backup")
    }
}
