package com.authbackup.app.model

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import com.authbackup.core.CoreError
import com.authbackup.core.OtpAccount
import com.authbackup.core.Otpauth
import java.util.UUID

/**
 * Collects keys from QR codes and links before they are saved: the import preview. Google Authenticator exports come
 * in batches of several QR codes; the batches seen so far are tracked so the person knows how many are left.
 */
class ImportBatch(var source: String = "qr") {
    data class Candidate(val otp: OtpAccount, val selected: Boolean = true, val id: String = UUID.randomUUID().toString())

    /** A key that could not be read: its name when the export had one, and why. */
    data class Problem(val name: String?, val error: CoreError)

    private data class MigrationBatch(val seen: Set<Long>, val size: Long)

    val candidates = mutableStateListOf<Candidate>()
    val problems = mutableStateListOf<Problem>()
    private val migrationBatches = mutableStateMapOf<Long, MigrationBatch>()

    val isEmpty get() = candidates.isEmpty() && problems.isEmpty()

    /** (seen, size) while a multi-QR export is incomplete, null otherwise. */
    val pendingMigration: Pair<Int, Int>?
        get() = migrationBatches.values.firstOrNull { it.size > 1 && it.seen.size < it.size }?.let { it.seen.size to it.size.toInt() }

    /** Adds what one scanned or pasted text holds. Returns false when the text is not an AuthBackup link at all. */
    fun add(text: String): Boolean {
        try {
            when (val parsed = Otpauth.parseAny(text)) {
                is Otpauth.Parsed.Otpauth -> append(parsed.account)
                is Otpauth.Parsed.Migration -> {
                    source = "google"
                    val batch = parsed.result.batch
                    val entry = migrationBatches[batch.id] ?: MigrationBatch(emptySet(), maxOf(batch.size, 1L))
                    if (batch.index in entry.seen) return true
                    migrationBatches[batch.id] = entry.copy(seen = entry.seen + batch.index)
                    parsed.result.accounts.forEach(::append)
                    problems += parsed.result.skipped.map { Problem(it.name, it.reason) }
                }
            }
            return true
        } catch (_: CoreError.NotOtp) {
            return false
        } catch (e: CoreError) {
            problems += Problem(null, e)
            return true
        }
    }

    fun append(account: OtpAccount) {
        if (candidates.none { it.otp.dedupKey == account.dedupKey }) candidates += Candidate(account)
    }

    fun setSelected(id: String, selected: Boolean) {
        val i = candidates.indexOfFirst { it.id == id }
        if (i >= 0) candidates[i] = candidates[i].copy(selected = selected)
    }

    val selectedAccounts get() = candidates.filter { it.selected }.map { it.otp }
}
