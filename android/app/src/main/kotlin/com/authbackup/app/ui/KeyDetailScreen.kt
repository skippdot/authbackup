package com.authbackup.app.ui

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import com.authbackup.app.R
import com.authbackup.app.model.AppLock
import com.authbackup.app.model.ErrorText
import com.authbackup.app.model.KeyStore
import com.authbackup.app.model.QrCodes
import com.authbackup.core.Base32
import com.authbackup.core.OtpType
import com.authbackup.core.Otpauth
import com.authbackup.core.title
import java.text.DateFormat
import java.time.Instant
import java.util.Date
import kotlinx.coroutines.launch

/** One key: rename it, see its parameters, show its QR code to move it to another app, delete it. */
@Composable
fun KeyDetailScreen(state: AppState, store: KeyStore, id: String) {
    val context = LocalContext.current
    val res = LocalResources.current
    val activity = LocalActivity.current as FragmentActivity
    val scope = rememberCoroutineScope()
    val item = store.accounts.firstOrNull { it.id == id }
    if (item == null) {
        // The key is gone (deleted elsewhere): leave, but not in the middle of composing.
        LaunchedEffect(id) { state.back() }
        return
    }
    var issuer by rememberSaveable(id) { mutableStateOf(item.otp.issuer) }
    var account by rememberSaveable(id) { mutableStateOf(item.otp.account) }
    var revealed by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val otp = item.otp

    Scaffold(topBar = {
        BackBar(otp.title ?: stringResource(R.string.no_name), state::back) {
            TextButton(onClick = {
                try {
                    store.rename(id, issuer, account)
                    state.back()
                } catch (e: Exception) {
                    error = ErrorText.message(res, e)
                }
            }, modifier = Modifier.testTag("saveKey")) { Text(stringResource(R.string.save)) }
        }
    }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(bottom = 24.dp)) {
                    SectionHeader(stringResource(R.string.name))
                    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(issuer, { issuer = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.service)) }, singleLine = true)
                        OutlinedTextField(account, { account = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.account)) }, singleLine = true)
                    }
                    SectionHeader(stringResource(R.string.parameters))
                    Value(stringResource(R.string.type), if (otp.type == OtpType.totp) "TOTP" else "HOTP")
                    Value(stringResource(R.string.algorithm), otp.algorithm.name)
                    Value(stringResource(R.string.digits), "${otp.digits}")
                    if (otp.type == OtpType.totp) {
                        Value(stringResource(R.string.period), stringResource(R.string.badge_period, otp.period))
                    } else {
                        Value(stringResource(R.string.counter), "${otp.counter}")
                    }
                    Value(stringResource(R.string.added), addedText(item.addedAt))

                    SectionHeader(stringResource(R.string.move_another_app))
                    if (revealed) {
                        val bitmap = remember(otp) { QrCodes.bitmap(Otpauth.build(otp)).asImageBitmap() }
                        Image(
                            bitmap,
                            contentDescription = stringResource(R.string.qr_code_key),
                            filterQuality = FilterQuality.None,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.align(Alignment.CenterHorizontally).widthIn(max = 260.dp).fillMaxWidth().padding(vertical = 8.dp).testTag("keyQr"),
                        )
                        SelectionContainer(Modifier.padding(horizontal = 16.dp)) {
                            Text(Base32.normalize(otp.secret).chunked4(), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodyLarge)
                        }
                    } else {
                        val reason = stringResource(R.string.show_secret_key)
                        OutlinedButton(
                            onClick = { scope.launch { if (AppLock.authenticate(activity, reason)) revealed = true } },
                            modifier = Modifier.padding(horizontal = 16.dp).testTag("reveal"),
                        ) {
                            Icon(Icons.Filled.Visibility, contentDescription = null)
                            Text(stringResource(R.string.show_qr_code_secret_key), Modifier.padding(start = 8.dp))
                        }
                    }
                    SectionFooter(stringResource(R.string.anyone_who_sees_qr_code))
                    TextButton(onClick = { confirmDelete = true }, modifier = Modifier.padding(horizontal = 8.dp).testTag("deleteKey")) {
                        Text(stringResource(R.string.delete_key), color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(stringResource(R.string.delete_key_question)) },
            text = { Text(stringResource(R.string.without_key_you_can_sign)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    try {
                        store.remove(id)
                        state.finish(res.getString(R.string.key_deleted))
                    } catch (e: Exception) {
                        error = ErrorText.message(res, e)
                    }
                }, modifier = Modifier.testTag("confirmDelete")) { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    error?.let {
        AlertDialog(
            onDismissRequest = { error = null },
            title = { Text(stringResource(R.string.cannot_save)) },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { error = null }) { Text(stringResource(R.string.ok)) } },
        )
    }
}

@Composable
fun Value(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun addedText(iso: String): String =
    runCatching { DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date.from(Instant.parse(iso))) }.getOrDefault("—")
