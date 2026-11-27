package com.authbackup.app.ui

import android.content.Intent
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EnhancedEncryption
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.fragment.app.FragmentActivity
import com.authbackup.app.R
import com.authbackup.app.model.AppLock
import com.authbackup.app.model.ErrorText
import com.authbackup.app.model.KeyStore
import com.authbackup.app.model.QrCodes
import com.authbackup.core.Backup
import com.authbackup.core.Migration
import com.authbackup.core.title
import java.text.DateFormat
import java.time.LocalDate
import java.util.Date
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SettingsScreen(state: AppState, store: KeyStore, lock: AppLock) {
    val context = LocalContext.current
    val res = LocalResources.current
    val activity = LocalActivity.current as FragmentActivity
    val scope = rememberCoroutineScope()
    val canLock = AppLock.canAuthenticate(context)
    val version = remember { context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty() }
    val googleReason = stringResource(R.string.show_your_keys_as_qr)

    Scaffold(topBar = { BackBar(stringResource(R.string.settings), state::back) }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                    SectionHeader(stringResource(R.string.security))
                    ListItem(
                        headlineContent = {
                            Text(stringResource(if (AppLock.hasBiometrics(context)) R.string.lock_with_biometrics else R.string.lock_with_screen_lock))
                        },
                        trailingContent = { Switch(checked = lock.enabled && canLock, onCheckedChange = { lock.enabled = it }, enabled = canLock, modifier = Modifier.testTag("lockSwitch")) },
                    )
                    SectionFooter(stringResource(if (canLock) R.string.codes_lock_when_authbackup_has else R.string.set_screen_lock_to_lock))

                    SectionHeader(stringResource(R.string.backup))
                    Value(
                        stringResource(R.string.last_backup),
                        store.lastBackupAt?.let { DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it)) }
                            ?: stringResource(R.string.never),
                    )
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.export_encrypted_backup)) },
                        leadingContent = { Icon(Icons.Filled.EnhancedEncryption, contentDescription = null) },
                        modifier = Modifier.testTag("exportBackup").clickableRow { if (store.accounts.isNotEmpty()) state.push(Route.BackupExport) },
                    )
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.export_google_authenticator)) },
                        leadingContent = { Icon(Icons.Filled.QrCode2, contentDescription = null) },
                        modifier = Modifier.testTag("exportGoogle").clickableRow {
                            if (store.accounts.isNotEmpty()) scope.launch {
                                if (AppLock.authenticate(activity, googleReason)) state.push(Route.GoogleExport)
                            }
                        },
                    )
                    SectionFooter(stringResource(R.string.keys_stored_only_here))

                    SectionHeader(stringResource(R.string.about))
                    Value(stringResource(R.string.version), version)
                    Link(stringResource(R.string.privacy_policy), "https://authbackup.com/privacy")
                    Link(stringResource(R.string.source_code), "https://github.com/skippdot/authbackup")
                    SectionFooter(stringResource(R.string.authbackup_has_no_servers_no))
                }
            }
        }
    }
}

/** Opens the browser; the app itself has no network access. */
@Composable
private fun Link(text: String, url: String) {
    val context = LocalContext.current
    ListItem(
        headlineContent = { Text(text, color = MaterialTheme.colorScheme.primary) },
        modifier = Modifier.clickableRow { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) } },
    )
}

/** The encrypted backup file, the same format the extension writes (docs/FORMATS.md, "Encrypted backup"). */
@Composable
fun BackupExportScreen(state: AppState, store: KeyStore) {
    val context = LocalContext.current
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var file by remember { mutableStateOf<ByteArray?>(null) }
    val problem = when {
        password.length < Backup.MIN_PASSWORD -> pluralStringResource(R.plurals.at_least_characters, Backup.MIN_PASSWORD, Backup.MIN_PASSWORD)
        password != confirm -> stringResource(R.string.passwords_do_not_match)
        else -> null
    }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        val data = file
        file = null
        if (uri == null || data == null) return@rememberLauncherForActivityResult
        try {
            context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(data) }
            store.markBackedUp()
            state.back()
        } catch (e: Exception) {
            error = ErrorText.message(res, e)
        }
    }

    Scaffold(topBar = { BackBar(stringResource(R.string.encrypted_backup), state::back) }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    listOf(password to { v: String -> password = v }, confirm to { v: String -> confirm = v }).forEachIndexed { i, (value, set) ->
                        OutlinedTextField(
                            value, set, Modifier.fillMaxWidth().testTag(if (i == 0) "newPassword" else "repeatPassword"),
                            label = { Text(stringResource(if (i == 0) R.string.password else R.string.repeat_password)) },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        )
                    }
                    Text(
                        stringResource(R.string.password_needed_open_file_it, problem ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Button(
                        onClick = {
                            val accounts = store.accounts
                            val pw = password
                            scope.launch {
                                working = true
                                val result = withContext(Dispatchers.Default) { runCatching { Backup.encryptedFile(accounts, pw) } }
                                working = false
                                result.fold({
                                    file = it
                                    save.launch("authbackup-${LocalDate.now()}.encrypted.json")
                                }) { error = ErrorText.message(res, it) }
                            }
                        },
                        enabled = problem == null && !working,
                        modifier = Modifier.fillMaxWidth().height(52.dp).testTag("createBackup"),
                    ) {
                        if (working) CircularProgressIndicator(Modifier.height(24.dp)) else Text(pluralStringResource(R.plurals.create_backup_file_keys, store.accounts.size, store.accounts.size))
                    }
                }
            }
        }
    }
    error?.let {
        AlertDialog(
            onDismissRequest = { error = null },
            title = { Text(stringResource(R.string.cannot_create_backup)) },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { error = null }) { Text(stringResource(R.string.ok)) } },
        )
    }
}

/** The keys as Google Authenticator export QR codes, up to 10 keys per code, for another device or app. */
@Composable
fun GoogleExportScreen(state: AppState, store: KeyStore) {
    val accounts = remember { store.accounts.map { it.otp } }
    val plan = remember(accounts) { Migration.plan(accounts) }
    Scaffold(topBar = { BackBar(stringResource(R.string.google_authenticator), state::back) }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                Column(Modifier.fillMaxSize().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (plan.uris.isEmpty()) {
                        Box(Modifier.weight(1f)) {
                            EmptyState(Icons.Filled.QrCode2, stringResource(R.string.nothing_export), stringResource(R.string.none_keys_fit_google_authenticator))
                        }
                    } else {
                        val pager = rememberPagerState { plan.uris.size }
                        HorizontalPager(pager, Modifier.weight(1f).testTag("googleQr")) { page ->
                            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                val bitmap = remember(page) { QrCodes.bitmap(plan.uris[page]).asImageBitmap() }
                                Image(
                                    bitmap, contentDescription = null, filterQuality = FilterQuality.None,
                                    modifier = Modifier.widthIn(max = 360.dp).fillMaxWidth().background(Color.White, RoundedCornerShape(12.dp)).padding(12.dp),
                                )
                                Text(
                                    stringResource(R.string.qr_code_keys, page + 1, plan.uris.size, plan.groups[page].size),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    if (plan.skipped.isNotEmpty()) {
                        val noName = stringResource(R.string.no_name)
                        Text(
                            stringResource(R.string.not_included_format_cannot_carry, plan.skipped.joinToString(", ") { accounts[it.index].title ?: noName }),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        stringResource(R.string.other_device_open_google_authenticator),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
            }
        }
    }
}
