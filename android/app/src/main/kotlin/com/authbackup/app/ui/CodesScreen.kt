package com.authbackup.app.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.authbackup.app.R
import com.authbackup.app.model.Clipboard
import com.authbackup.app.model.ErrorText
import com.authbackup.app.model.KeyStore
import com.authbackup.core.Display
import com.authbackup.core.Otp
import com.authbackup.core.OtpType
import com.authbackup.core.StoredAccount
import com.authbackup.core.badges
import com.authbackup.core.subtitle
import com.authbackup.core.title
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The main screen: every key with its current code. A tap copies the code. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CodesScreen(state: AppState, store: KeyStore) {
    val context = LocalContext.current
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var search by rememberSaveable { mutableStateOf("") }
    var deleting by remember { mutableStateOf<StoredAccount?>(null) }

    fun show(message: String) {
        scope.launch {
            state.snackbar.currentSnackbarData?.dismiss()
            state.snackbar.showSnackbar(message)
        }
    }

    LaunchedEffect(state.pending) {
        state.pending?.let { state.pending = null; show(it) }
    }

    /**
     * Copies the code. A TOTP code that changes in under 3 seconds would expire before it is pasted, so the next one
     * is copied instead (as in the extension).
     */
    fun copy(item: StoredAccount) {
        try {
            val code = if (item.otp.type == OtpType.hotp) {
                store.takeHotpCode(item.id)
            } else {
                var ms = System.currentTimeMillis().toDouble()
                if (Otp.secondsLeft(item.otp.period, ms) < 3) ms += 3000
                Otp.code(item.otp, ms)
            }
            Clipboard.copyCode(context, code)
            haptics.performHapticFeedback(HapticFeedbackType.Confirm)
            show(res.getString(R.string.copied, Display.group(code)))
        } catch (e: Exception) {
            show(ErrorText.message(res, e))
        }
    }

    fun guarded(action: () -> Unit) {
        try {
            action()
        } catch (e: Exception) {
            show(ErrorText.message(res, e))
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    IconButton(onClick = { state.push(Route.Settings) }, modifier = Modifier.testTag("settings")) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.settings))
                    }
                },
            )
        },
        floatingActionButton = {
            if (store.accounts.isNotEmpty() && store.loadError == null) {
                FloatingActionButton(onClick = { state.push(Route.Add) }, modifier = Modifier.testTag("addKeys")) {
                    Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.add_keys))
                }
            }
        },
        snackbarHost = { SnackbarHost(state.snackbar) },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            when {
                store.loadError != null -> EmptyState(
                    Icons.Filled.Lock,
                    stringResource(R.string.keys_cannot_read),
                    stringResource(R.string.unlock_device_open_authbackup_again),
                )
                store.accounts.isEmpty() -> EmptyState(
                    Icons.Filled.QrCodeScanner,
                    stringResource(R.string.no_keys_yet),
                    stringResource(R.string.scan_qr_code_website_shows),
                ) {
                    Button(onClick = { state.push(Route.Add) }, modifier = Modifier.testTag("addKeys")) {
                        Text(stringResource(R.string.add_keys))
                    }
                }
                else -> Centered {
                    CodeList(
                        store = store,
                        search = search,
                        onSearch = { search = it },
                        onSettings = { state.push(Route.Settings) },
                        onCopy = ::copy,
                        onEdit = { state.push(Route.Detail(it.id)) },
                        onDelete = { deleting = it },
                        onMove = { from, to -> guarded { store.move(from, to) } },
                    )
                }
            }
        }
    }

    deleting?.let { item ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text(stringResource(R.string.delete_key_question)) },
            text = { Text(stringResource(R.string.without_key_you_can_sign)) },
            confirmButton = {
                TextButton(onClick = {
                    deleting = null
                    guarded { store.remove(item.id) }
                }, modifier = Modifier.testTag("confirmDelete")) {
                    Text(
                        stringResource(R.string.delete_named, item.otp.title ?: stringResource(R.string.no_name)),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            },
            dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun CodeList(
    store: KeyStore,
    search: String,
    onSearch: (String) -> Unit,
    onSettings: () -> Unit,
    onCopy: (StoredAccount) -> Unit,
    onEdit: (StoredAccount) -> Unit,
    onDelete: (StoredAccount) -> Unit,
    onMove: (Int, Int) -> Unit,
) {
    // One clock for every row, on the second.
    val now by produceState(System.currentTimeMillis()) {
        while (true) {
            value = System.currentTimeMillis()
            delay(1000 - value % 1000)
        }
    }
    val q = search.trim()
    val all = store.accounts
    val filtered = if (q.isEmpty()) all else all.filter { it.otp.issuer.contains(q, true) || it.otp.account.contains(q, true) }
    LazyColumn(Modifier.fillMaxSize().testTag("codes")) {
        item {
            OutlinedTextField(
                value = search,
                onValueChange = onSearch,
                placeholder = { Text(stringResource(R.string.search)) },
                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp).testTag("search"),
            )
        }
        if (store.lastBackupAt == null && q.isEmpty()) {
            item { BackupReminder(onSettings) }
        }
        items(filtered, key = { it.id }) { item ->
            // Reordering only makes sense on the full list, not on search results.
            val index = if (q.isEmpty()) all.indexOf(item) else -1
            CodeRow(
                item = item,
                now = now,
                onCopy = { onCopy(item) },
                onEdit = { onEdit(item) },
                onDelete = { onDelete(item) },
                onMoveUp = if (index > 0) ({ onMove(index, index - 1) }) else null,
                onMoveDown = if (index >= 0 && index < all.lastIndex) ({ onMove(index, index + 1) }) else null,
            )
            HorizontalDivider()
        }
        if (filtered.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.no_results, q),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                )
            }
        }
        item { Spacer(Modifier.height(88.dp)) } // room under the add button
    }
}

@Composable
private fun BackupReminder(onClick: () -> Unit) {
    Card(
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).testTag("backupReminder"),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = Warning)
            Spacer(Modifier.width(12.dp))
            Column {
                Text(stringResource(R.string.no_backup_yet), style = MaterialTheme.typography.titleSmall)
                Text(
                    stringResource(R.string.if_you_lose_device_backup),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun CodeRow(
    item: StoredAccount,
    now: Long,
    onCopy: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
    onMoveUp: (() -> Unit)?,
    onMoveDown: (() -> Unit)?,
) {
    var menu by remember { mutableStateOf(false) }
    val otp = item.otp
    val copyLabel = stringResource(R.string.copies_code)
    val labels = listOf(
        stringResource(R.string.edit) to onEdit,
        stringResource(R.string.delete) to onDelete,
    ) + listOfNotNull(
        onMoveUp?.let { stringResource(R.string.move_up) to it },
        onMoveDown?.let { stringResource(R.string.move_down) to it },
    )
    Row(
        Modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onCopy, onLongClick = { menu = true })
            .semantics {
                onClick(label = copyLabel) { onCopy(); true }
                customActions = labels.map { (label, action) -> CustomAccessibilityAction(label) { action(); true } }
            }
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .testTag("code-${otp.title ?: ""}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(otp.title ?: stringResource(R.string.no_name), style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (otp.subtitle.isNotEmpty()) {
                Text(otp.subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            BadgeRow(otp.badges)
        }
        Spacer(Modifier.width(8.dp))
        if (otp.type == OtpType.hotp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Refresh, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.get_code), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelLarge)
            }
        } else {
            val ms = now.toDouble()
            val left = Otp.secondsLeft(otp.period, ms)
            val code = runCatching { Otp.code(otp, ms) }.getOrDefault("")
            CodeText(Display.group(code), warn = left <= 5)
            Spacer(Modifier.width(10.dp))
            Countdown(left, otp.period)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.copy_code)) }, leadingIcon = { Icon(Icons.Filled.ContentCopy, null) }, onClick = { menu = false; onCopy() })
            DropdownMenuItem(text = { Text(stringResource(R.string.edit)) }, leadingIcon = { Icon(Icons.Filled.Edit, null) }, onClick = { menu = false; onEdit() })
            onMoveUp?.let { DropdownMenuItem(text = { Text(stringResource(R.string.move_up)) }, leadingIcon = { Icon(Icons.Filled.KeyboardArrowUp, null) }, onClick = { menu = false; it() }) }
            onMoveDown?.let { DropdownMenuItem(text = { Text(stringResource(R.string.move_down)) }, leadingIcon = { Icon(Icons.Filled.KeyboardArrowDown, null) }, onClick = { menu = false; it() }) }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) },
                leadingIcon = { Icon(Icons.Filled.Delete, null, tint = MaterialTheme.colorScheme.error) },
                onClick = { menu = false; onDelete() },
                modifier = Modifier.testTag("menuDelete"),
            )
        }
    }
}
