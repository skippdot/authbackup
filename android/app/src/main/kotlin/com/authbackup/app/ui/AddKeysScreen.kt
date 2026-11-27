package com.authbackup.app.ui

import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentPaste
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.authbackup.app.R
import com.authbackup.app.model.Clipboard
import com.authbackup.app.model.ErrorText
import com.authbackup.app.model.ImportBatch
import com.authbackup.app.model.KeyStore
import com.authbackup.app.model.QrCodes
import com.authbackup.core.Backup
import com.authbackup.core.CoreError
import com.authbackup.core.OtpAccount
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement

/** Every way a key gets in: camera, an image, the clipboard, typing it, or a backup file. */
@Composable
fun AddKeysScreen(state: AppState, store: KeyStore) {
    val context = LocalContext.current
    val res = LocalResources.current
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf<String?>(null) }
    var vault by remember { mutableStateOf<JsonElement?>(null) }
    var password by remember { mutableStateOf("") }

    fun showPreview(texts: List<String>, source: String) {
        val next = ImportBatch(source)
        val recognized = texts.map { next.add(it) }.contains(true)
        if (!recognized) {
            alert = if (texts.isEmpty()) res.getString(R.string.no_qr_code_was_found) else ErrorText.message(res, CoreError.NotOtp)
            return
        }
        state.batch = next
        state.replaceAbove(Route.Add, Route.Preview)
    }

    /** A backup is restored at once, like in the extension: every key in the file, minus the ones already saved. */
    fun restore(accounts: List<OtpAccount>) {
        try {
            val r = store.add(accounts, "backup")
            state.finish(res.getString(R.string.restored_already_saved, r.added, r.duplicates))
        } catch (e: Exception) {
            alert = ErrorText.message(res, e)
        }
    }

    fun busy(block: suspend () -> Unit) {
        scope.launch {
            working = true
            try {
                block()
            } finally {
                working = false
            }
        }
    }

    val photo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) busy {
            val texts = withContext(Dispatchers.Default) { QrCodes.load(context, uri)?.let(QrCodes::read) }
            if (texts == null) alert = res.getString(R.string.image_cannot_opened) else showPreview(texts, "image")
        }
    }

    val file = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) busy {
            val data = withContext(Dispatchers.IO) { readBytes(context, uri) }
            if (data == null) {
                alert = res.getString(R.string.file_cannot_opened)
                return@busy
            }
            try {
                when (val content = Backup.read(data)) {
                    is Backup.Content.Encrypted -> {
                        password = ""
                        vault = content.vault
                    }
                    is Backup.Content.Entries -> restore(Backup.restore(content.entries))
                    is Backup.Content.Links -> showPreview(content.text.split(Regex("\\s+")).filter { it.isNotEmpty() }, "link")
                }
            } catch (e: CoreError) {
                alert = ErrorText.message(res, e)
            }
        }
    }

    fun paste() = busy {
        val items = Clipboard.read(context)
        if (items.isEmpty()) {
            alert = res.getString(R.string.clipboard_empty)
            return@busy
        }
        val texts = withContext(Dispatchers.Default) {
            items.flatMap { item ->
                when (item) {
                    // Several links may be pasted at once, one per line.
                    is Clipboard.Content.Text -> item.text.split(Regex("\\s+")).filter { it.isNotEmpty() }
                    is Clipboard.Content.Image -> QrCodes.load(context, item.uri)?.let(QrCodes::read).orEmpty()
                }
            }
        }
        showPreview(texts, "link")
    }

    fun decrypt() {
        val v = vault ?: return
        val pw = password
        password = ""
        vault = null
        busy {
            // PBKDF2 with 600,000 rounds takes a moment: off the main thread.
            val result = withContext(Dispatchers.Default) { runCatching { Backup.restore(Backup.open(v, pw)) } }
            result.fold(::restore) { alert = ErrorText.message(res, it) }
        }
    }

    Scaffold(topBar = { BackBar(stringResource(R.string.add_keys), state::back) }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Action(Icons.Filled.QrCodeScanner, stringResource(R.string.scan_qr_code), "scan") {
                        state.batch = ImportBatch()
                        state.push(Route.Scanner)
                    }
                    Action(Icons.Filled.PhotoLibrary, stringResource(R.string.choose_screenshot_photo), "photo") {
                        photo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }
                    Action(Icons.Filled.ContentPaste, stringResource(R.string.paste_from_clipboard), "paste", ::paste)
                    Action(Icons.Filled.Keyboard, stringResource(R.string.enter_key_manually), "manualEntry") { state.push(Route.Manual) }
                    SectionFooter(stringResource(R.string.works_qr_code_website_shows))
                    Action(Icons.Filled.UploadFile, stringResource(R.string.restore_backup_file), "restoreFile") {
                        file.launch(arrayOf("application/json", "text/plain", "application/octet-stream", "*/*"))
                    }
                    SectionFooter(stringResource(R.string.encrypted_backup_json_backup_from))
                }
            }
            if (working) Busy()
        }
    }

    alert?.let {
        AlertDialog(
            onDismissRequest = { alert = null },
            title = { Text(stringResource(R.string.cannot_add_keys)) },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { alert = null }) { Text(stringResource(R.string.ok)) } },
        )
    }

    if (vault != null) {
        AlertDialog(
            onDismissRequest = { vault = null; password = "" },
            title = { Text(stringResource(R.string.backup_password)) },
            text = {
                Column {
                    Text(stringResource(R.string.password_was_set_when_backup))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text(stringResource(R.string.password)) },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        modifier = Modifier.testTag("backupPassword"),
                    )
                }
            },
            confirmButton = { TextButton(onClick = ::decrypt, modifier = Modifier.testTag("decrypt")) { Text(stringResource(R.string.decrypt)) } },
            dismissButton = { TextButton(onClick = { vault = null; password = "" }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun Action(icon: ImageVector, text: String, tag: String, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(text) },
        leadingContent = { Icon(icon, contentDescription = null) },
        modifier = Modifier.testTag(tag).clickableRow(onClick),
    )
}

/** Backup files are small; anything over 10 MB is not one. */
private fun readBytes(context: Context, uri: Uri): ByteArray? = runCatching {
    context.contentResolver.openInputStream(uri)?.use { input ->
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            if (out.size() + n > MAX_FILE_BYTES) return@use null
            out.write(buffer, 0, n)
        }
        out.toByteArray()
    }
}.getOrNull()

private const val MAX_FILE_BYTES = 10 * 1024 * 1024
