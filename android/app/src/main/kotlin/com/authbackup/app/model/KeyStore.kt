package com.authbackup.app.model

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.authbackup.core.OtpAccount
import com.authbackup.core.Otp
import com.authbackup.core.StoredAccount
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * The list of keys, kept in [SecretStore]. Mirrors the extension's lib/store.js and the iOS app's KeyStore: the same
 * deduplication, ids, `source` and `addedAt`, so backup files move between them without loss.
 */
class KeyStore(private val secrets: SecretStore, private val prefs: Prefs) {
    var accounts by mutableStateOf(emptyList<StoredAccount>())
        private set

    /**
     * The list could not be read. Writes are refused until it can, so a read error never turns into an empty list
     * written over the real one.
     */
    var loadError by mutableStateOf<String?>(null)
        private set

    /** Milliseconds since the epoch, or null before the first backup. */
    var lastBackupAt by mutableStateOf(prefs.getLong(LAST_BACKUP_KEY))
        private set

    @Serializable
    private data class Registry(val version: Int = 1, val accounts: List<StoredAccount>)

    data class AddResult(val added: Int = 0, val duplicates: Int = 0)

    class NotLoadedException(reason: String) : IllegalStateException(reason)

    init {
        load()
    }

    fun load() {
        try {
            accounts = secrets.read()?.let { json.decodeFromString<Registry>(it.decodeToString()).accounts } ?: emptyList()
            loadError = null
        } catch (e: Exception) {
            loadError = e.toString()
        }
    }

    private fun save(list: List<StoredAccount>) {
        loadError?.let { throw NotLoadedException(it) }
        secrets.write(json.encodeToString(Registry.serializer(), Registry(accounts = list)).encodeToByteArray())
        accounts = list
    }

    fun isKnown(candidate: OtpAccount) = accounts.any { it.otp.dedupKey == candidate.dedupKey }

    /** Adds keys, skipping ones already saved (same type, secret, issuer and account) and repeats within the batch. */
    fun add(candidates: List<OtpAccount>, source: String): AddResult {
        val list = accounts.toMutableList()
        val keys = list.mapTo(HashSet()) { it.otp.dedupKey }
        var added = 0
        var duplicates = 0
        for (c in candidates) {
            if (keys.add(c.dedupKey)) {
                list += StoredAccount(otp = c, source = source)
                added++
            } else {
                duplicates++
            }
        }
        if (added > 0) save(list)
        return AddResult(added, duplicates)
    }

    fun rename(id: String, issuer: String, account: String) {
        save(accounts.map { if (it.id == id) it.copy(otp = it.otp.copy(issuer = issuer.trim(), account = account.trim())) else it })
    }

    fun remove(id: String) = save(accounts.filter { it.id != id })

    /** Moves the key at [from] to [to] (indexes in the full list). */
    fun move(from: Int, to: Int) {
        val list = accounts.toMutableList()
        if (from !in list.indices || to !in list.indices || from == to) return
        list.add(to, list.removeAt(from))
        save(list)
    }

    /** HOTP codes are single-use: returns the code for the current counter and advances the counter, as the extension does. */
    fun takeHotpCode(id: String): String {
        val item = accounts.first { it.id == id }
        val code = Otp.code(item.otp)
        save(accounts.map { if (it.id == id) it.copy(otp = it.otp.copy(counter = it.otp.counter + 1)) else it })
        return code
    }

    fun markBackedUp(at: Long = System.currentTimeMillis()) {
        lastBackupAt = at
        prefs.putLong(LAST_BACKUP_KEY, at)
    }

    private companion object {
        const val LAST_BACKUP_KEY = "lastBackupAt"
        val json = Json { ignoreUnknownKeys = true }
    }
}
