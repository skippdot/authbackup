package com.authbackup.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.authbackup.app.R
import com.authbackup.app.model.AppLock
import com.authbackup.app.model.KeyStore
import kotlinx.coroutines.launch

/** Codes are not even composed while the app is locked. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun AuthBackupRoot(store: KeyStore, lock: AppLock) {
    val state: AppState = viewModel()
    // Test tags double as resource ids, so the UI walkthrough (UiAutomator) finds elements the way it finds system ones.
    Surface(Modifier.fillMaxSize().semantics { testTagsAsResourceId = true }) {
        if (lock.isLocked) {
            LockScreen(lock)
        } else {
            BackHandler(enabled = state.stack.size > 1) { state.back() }
            when (val route = state.top) {
                Route.Codes -> CodesScreen(state, store)
                Route.Add -> AddKeysScreen(state, store)
                Route.Scanner -> ScannerScreen(state)
                Route.Preview -> ImportPreviewScreen(state, store)
                Route.Manual -> ManualEntryScreen(state, store)
                is Route.Detail -> KeyDetailScreen(state, store, route.id)
                Route.Settings -> SettingsScreen(state, store, lock)
                Route.BackupExport -> BackupExportScreen(state, store)
                Route.GoogleExport -> GoogleExportScreen(state, store)
            }
        }
    }
}

@Composable
private fun LockScreen(lock: AppLock) {
    val activity = LocalActivity.current as FragmentActivity
    val scope = rememberCoroutineScope()
    val title = stringResource(R.string.unlock_your_codes)
    LaunchedEffect(Unit) { lock.unlock(activity, title) }
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(1f))
        Icon(Icons.Filled.Shield, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(64.dp))
        Spacer(Modifier.height(20.dp))
        Text(stringResource(R.string.authbackup_locked), style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text(
            stringResource(R.string.your_codes_hidden_until_you),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.weight(1f))
        Button(
            onClick = { scope.launch { lock.unlock(activity, title) } },
            enabled = !lock.isAuthenticating,
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("unlock"),
        ) { Text(stringResource(R.string.unlock)) }
    }
}
