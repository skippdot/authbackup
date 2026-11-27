package com.authbackup.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.authbackup.app.R
import com.authbackup.app.model.ErrorText
import com.authbackup.app.model.KeyStore
import com.authbackup.core.Base32
import com.authbackup.core.CoreError
import com.authbackup.core.OtpAccount
import com.authbackup.core.OtpAlgorithm
import com.authbackup.core.OtpType
import com.authbackup.core.Otpauth

/** Typing a key in: for sites that show the secret as text ("can't scan the code?"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualEntryScreen(state: AppState, store: KeyStore) {
    val context = LocalContext.current
    val res = LocalResources.current
    var issuer by rememberSaveable { mutableStateOf("") }
    var account by rememberSaveable { mutableStateOf("") }
    var secret by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf(OtpType.totp) }
    var algorithm by rememberSaveable { mutableStateOf(OtpAlgorithm.SHA1) }
    var digits by rememberSaveable { mutableIntStateOf(6) }
    var period by rememberSaveable { mutableIntStateOf(30) }
    var counter by rememberSaveable { mutableLongStateOf(0L) }
    var error by remember { mutableStateOf<String?>(null) }

    fun add() {
        if (!Base32.isValid(secret)) {
            error = ErrorText.message(res, CoreError.Base32Chars)
            return
        }
        val draft = OtpAccount(
            type = type, issuer = issuer, account = account, secret = Base32.normalize(secret),
            algorithm = algorithm, digits = digits, period = period, counter = counter,
        )
        try {
            // Through a link and back, so a typed key is checked exactly like a scanned one.
            val parsed = Otpauth.parse(Otpauth.build(draft))
            val r = store.add(listOf(parsed), "manual")
            state.finish(
                if (r.added > 0) res.getQuantityString(R.plurals.added_n_keys, r.added, r.added)
                else res.getString(R.string.key_already_saved),
            )
        } catch (e: Exception) {
            error = ErrorText.message(res, e)
        }
    }

    Scaffold(topBar = {
        BackBar(stringResource(R.string.enter_key), state::back) {
            TextButton(onClick = ::add, enabled = secret.isNotBlank(), modifier = Modifier.testTag("saveManual")) {
                Text(stringResource(R.string.add))
            }
        }
    }) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(
                        issuer, { issuer = it }, Modifier.fillMaxWidth().testTag("issuer"),
                        label = { Text(stringResource(R.string.service_example_github)) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                    )
                    OutlinedTextField(
                        account, { account = it }, Modifier.fillMaxWidth().testTag("account"),
                        label = { Text(stringResource(R.string.account_example_your_email)) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
                    )
                    OutlinedTextField(
                        secret, { secret = it }, Modifier.fillMaxWidth().testTag("secret"),
                        label = { Text(stringResource(R.string.secret_key)) },
                        textStyle = MaterialTheme.typography.bodyLarge.copy(fontFamily = FontFamily.Monospace),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
                        supportingText = { Text(stringResource(R.string.key_text_website_shows_next)) },
                    )
                    SectionHeader(stringResource(R.string.advanced))
                    Choice(stringResource(R.string.type), listOf(OtpType.totp to stringResource(R.string.time_based_totp), OtpType.hotp to stringResource(R.string.counter_based_hotp)), type) { type = it }
                    Choice(stringResource(R.string.algorithm), OtpAlgorithm.entries.map { it to it.name }, algorithm) { algorithm = it }
                    Choice(stringResource(R.string.digits), listOf(6, 7, 8).map { it to "$it" }, digits) { digits = it }
                    if (type == OtpType.totp) {
                        Stepper(stringResource(R.string.period_s, period), period > 5, period < 300, { period -= 5 }, { period += 5 })
                    } else {
                        Stepper(stringResource(R.string.counter_value, counter), counter > 0, counter < 1_000_000, { counter-- }, { counter++ })
                    }
                }
            }
        }
    }

    error?.let {
        AlertDialog(
            onDismissRequest = { error = null },
            title = { Text(stringResource(R.string.cannot_add_key)) },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { error = null }) { Text(stringResource(R.string.ok)) } },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> Choice(label: String, options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(bottom = 4.dp))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            options.forEachIndexed { i, (value, text) ->
                SegmentedButton(
                    selected = value == selected,
                    onClick = { onSelect(value) },
                    shape = SegmentedButtonDefaults.itemShape(i, options.size),
                ) { Text(text, maxLines = 1) }
            }
        }
    }
}

@Composable
private fun Stepper(label: String, canDown: Boolean, canUp: Boolean, down: () -> Unit, up: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        IconButton(onClick = down, enabled = canDown) { Icon(Icons.Filled.Remove, contentDescription = null) }
        IconButton(onClick = up, enabled = canUp) { Icon(Icons.Filled.Add, contentDescription = null) }
    }
}
