package com.authbackup.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The brand blue of the extension and the website (#2f5bea); lighter in the dark, as the iOS accent colour. */
private val Light = lightColorScheme(
    primary = Color(0xFF2F5BEA),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFDDE4FF),
    onPrimaryContainer = Color(0xFF00174B),
)
private val Dark = darkColorScheme(
    primary = Color(0xFF6688FB),
    onPrimary = Color(0xFF002780),
    primaryContainer = Color(0xFF1C3FB8),
    onPrimaryContainer = Color(0xFFDDE4FF),
)

/** Codes about to change, and warnings. */
val Warning = Color(0xFFE8710A)

@Composable
fun AuthBackupTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
