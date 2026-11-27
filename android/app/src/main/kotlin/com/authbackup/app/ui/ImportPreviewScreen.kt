package com.authbackup.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import com.authbackup.app.R
import com.authbackup.app.model.ErrorText
import com.authbackup.app.model.KeyStore
import com.authbackup.core.badges
import com.authbackup.core.subtitle
import com.authbackup.core.title

/** What was found, before anything is saved: pick the keys to add. Keys already saved are shown, unticked. */
@Composable
fun ImportPreviewScreen(state: AppState, store: KeyStore) {
    val context = LocalContext.current
    val res = LocalResources.current
    val batch = state.batch
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(batch) {
        batch.candidates.filter { store.isKnown(it.otp) }.forEach { batch.setSelected(it.id, false) }
    }
    val count = batch.selectedAccounts.size

    Scaffold(
        topBar = { BackBar(stringResource(R.string.add_keys), state::back) },
        bottomBar = {
            Surface(tonalElevation = 3.dp) {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Button(
                        onClick = {
                            try {
                                val r = store.add(batch.selectedAccounts, batch.source)
                                state.finish(res.getQuantityString(R.plurals.added_n_keys, r.added, r.added))
                            } catch (e: Exception) {
                                error = ErrorText.message(res, e)
                            }
                        },
                        enabled = count > 0,
                        modifier = Modifier.readableWidth().navigationBarsPadding().padding(16.dp).height(52.dp).testTag("addSelected"),
                    ) { Text(pluralStringResource(R.plurals.add_n_keys, count, count)) }
                }
            }
        },
    ) { padding ->
        Box(Modifier.padding(padding).fillMaxSize()) {
            Centered {
                LazyColumn(Modifier.fillMaxSize()) {
                    batch.pendingMigration?.let { (seen, size) ->
                        item {
                            Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Warning, contentDescription = null, tint = Warning)
                                Spacer(Modifier.width(12.dp))
                                Text(stringResource(R.string.only_qr_codes_export_were, seen, size), color = Warning)
                            }
                        }
                    }
                    if (batch.candidates.isNotEmpty()) {
                        item { SectionHeader(stringResource(R.string.keys_found)) }
                        items(batch.candidates, key = { it.id }) { candidate ->
                            val known = store.isKnown(candidate.otp)
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .toggleable(candidate.selected, enabled = !known, role = Role.Checkbox) { batch.setSelected(candidate.id, it) }
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(candidate.otp.title ?: stringResource(R.string.no_name), style = MaterialTheme.typography.titleMedium)
                                    if (candidate.otp.subtitle.isNotEmpty()) {
                                        Text(candidate.otp.subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    BadgeRow(candidate.otp.badges)
                                    if (known) {
                                        Text(stringResource(R.string.already_saved), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                Checkbox(checked = candidate.selected, onCheckedChange = null, enabled = !known)
                            }
                        }
                    }
                    if (batch.problems.isNotEmpty()) {
                        item { SectionHeader(stringResource(R.string.not_added)) }
                        items(batch.problems) { problem ->
                            val reason = ErrorText.message(res, problem.error)
                            Text(
                                if (problem.name != null) "${problem.name}: $reason" else reason,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }

    error?.let {
        AlertDialog(
            onDismissRequest = { error = null },
            title = { Text(stringResource(R.string.cannot_add_keys)) },
            text = { Text(it) },
            confirmButton = { TextButton(onClick = { error = null }) { Text(stringResource(R.string.ok)) } },
        )
    }
}
