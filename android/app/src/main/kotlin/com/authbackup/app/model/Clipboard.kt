package com.authbackup.app.model

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle

/** Codes on the clipboard: marked sensitive, so the system does not show them in its copy preview or suggestions. */
object Clipboard {
    private const val CLEAR_AFTER_MS = 90_000L

    /** ClipDescription.EXTRA_IS_SENSITIVE (Android 13); on older versions the same key is simply ignored or read by
     * keyboards that know it. */
    private const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"
    private val handler = Handler(Looper.getMainLooper())

    fun copyCode(context: Context, code: String) {
        val manager = context.getSystemService(ClipboardManager::class.java)
        val clip = ClipData.newPlainText("AuthBackup", code).apply {
            description.extras = PersistableBundle().apply { putBoolean(EXTRA_IS_SENSITIVE, true) }
        }
        manager.setPrimaryClip(clip)
        // Cleared after 90 seconds, as on iOS, but only if the code is still there (Android lets an app read the
        // clipboard only while it is in front; otherwise the code stays until the system clears it).
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({
            val current = runCatching { manager.primaryClip?.getItemAt(0)?.text?.toString() }.getOrNull()
            if (current == code) manager.clearPrimaryClip()
        }, CLEAR_AFTER_MS)
    }

    /** What the clipboard holds: text (one or more links) or an image. */
    sealed interface Content {
        data class Text(val text: String) : Content
        data class Image(val uri: android.net.Uri) : Content
    }

    fun read(context: Context): List<Content> {
        val clip = context.getSystemService(ClipboardManager::class.java).primaryClip ?: return emptyList()
        return (0 until clip.itemCount).mapNotNull { i ->
            val item = clip.getItemAt(i)
            val uri = item.uri
            when {
                uri != null && context.contentResolver.getType(uri)?.startsWith("image/") == true -> Content.Image(uri)
                item.text != null -> Content.Text(item.text.toString())
                else -> null
            }
        }
    }
}
