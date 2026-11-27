package com.authbackup.app.model

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Biometrics or the screen lock in front of the codes. On by default when the device has a screen lock; codes lock
 * again after the app has spent a minute in the background, so copying a code into another app does not ask every time.
 */
class AppLock(private val prefs: Prefs, private val canAuthenticate: () -> Boolean) {
    private var backgroundedAt: Long? = null

    private var enabledState by mutableStateOf(prefs.getBoolean(ENABLED_KEY) ?: true)

    var enabled: Boolean
        get() = enabledState
        set(value) {
            enabledState = value
            prefs.putBoolean(ENABLED_KEY, value)
        }

    var isLocked by mutableStateOf(enabled && canAuthenticate())
        private set

    var isAuthenticating by mutableStateOf(false)
        private set

    fun onBackground(now: Long = System.currentTimeMillis()) {
        if (backgroundedAt == null) backgroundedAt = now
    }

    fun onForeground(now: Long = System.currentTimeMillis()) {
        val since = backgroundedAt
        if (since != null && now - since > GRACE_MS && enabled && canAuthenticate()) isLocked = true
        backgroundedAt = null
    }

    suspend fun unlock(activity: FragmentActivity, title: String) {
        if (!isLocked || isAuthenticating) return
        isAuthenticating = true
        try {
            if (authenticate(activity, title)) isLocked = false
        } finally {
            isAuthenticating = false
        }
    }

    companion object {
        const val GRACE_MS = 60_000L
        private const val ENABLED_KEY = "lockEnabled"

        /** Any biometric the device offers, or the PIN, pattern or password of the screen lock. */
        private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL

        /** False when the device has no screen lock: then there is nothing to unlock with. */
        fun canAuthenticate(context: Context) =
            BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS

        fun hasBiometrics(context: Context) =
            BiometricManager.from(context).canAuthenticate(BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

        /** Asks for biometrics or the screen lock; true on success. Used to unlock and before showing a secret. */
        suspend fun authenticate(activity: FragmentActivity, title: String): Boolean {
            if (!canAuthenticate(activity)) return true
            return suspendCancellableCoroutine { continuation ->
                val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(true)
                    }

                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        if (continuation.isActive) continuation.resume(false)
                    }
                })
                prompt.authenticate(
                    BiometricPrompt.PromptInfo.Builder().setTitle(title).setAllowedAuthenticators(AUTHENTICATORS).build(),
                )
                continuation.invokeOnCancellation { prompt.cancelAuthentication() }
            }
        }
    }
}
