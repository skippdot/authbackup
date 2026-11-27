package com.authbackup.app

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import com.authbackup.app.ui.AuthBackupRoot
import com.authbackup.app.ui.AuthBackupTheme

/** A FragmentActivity because BiometricPrompt needs one. */
class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Codes stay out of the recent apps preview (the iOS app covers them in the app switcher). Screenshots and
        // screen recording keep working while the app is in front.
        if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)
        val app = application as AuthBackupApplication
        setContent {
            AuthBackupTheme { AuthBackupRoot(app.store, app.lock) }
        }
    }

    // Before Android 13 the preview is taken after onPause: the window is marked secure only while in the background.
    override fun onPause() {
        super.onPause()
        if (Build.VERSION.SDK_INT < 33) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }

    override fun onResume() {
        super.onResume()
        if (Build.VERSION.SDK_INT < 33) window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
}
