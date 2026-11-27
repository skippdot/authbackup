package com.authbackup.app

import com.authbackup.app.model.AppLock
import com.authbackup.app.model.ImportBatch
import com.authbackup.app.model.KeyStore
import com.authbackup.app.model.MemoryPrefs
import com.authbackup.app.model.MemoryStore
import com.authbackup.core.Backup
import com.authbackup.core.CoreError
import com.authbackup.core.Migration
import com.authbackup.core.OtpAccount
import com.authbackup.core.OtpType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/** The key list on top of a memory store: the same deduplication as the extension, and no write over a list that
 * could not be read. The same cases as ios/AppTests/KeyStoreTests.swift. */
class KeyStoreTest {
    private fun store(secrets: MemoryStore = MemoryStore()) = KeyStore(secrets, MemoryPrefs())

    private val alice = OtpAccount(issuer = "Example", account = "alice@example.com", secret = "JBSWY3DPEHPK3PXP")

    @Test fun addsAndSkipsDuplicates() {
        val s = store()
        val copy = alice.copy(issuer = "EXAMPLE") // the dedup key ignores case in names
        assertEquals(KeyStore.AddResult(added = 1, duplicates = 1), s.add(listOf(alice, copy), "qr"))
        assertEquals(KeyStore.AddResult(added = 0, duplicates = 1), s.add(listOf(alice), "qr"))
        assertEquals(1, s.accounts.size)
        assertEquals("qr", s.accounts[0].source)
    }

    @Test fun persistsAcrossLaunches() {
        val secrets = MemoryStore()
        store(secrets).add(listOf(alice), "manual")
        assertEquals(listOf(alice), store(secrets).accounts.map { it.otp })
    }

    @Test fun refusesToWriteOverAnUnreadableList() {
        val s = store(MemoryStore("not json".encodeToByteArray()))
        assertNotNull(s.loadError)
        assertThrows(KeyStore.NotLoadedException::class.java) { s.add(listOf(alice), "qr") }
    }

    @Test fun hotpAdvancesTheCounter() {
        val s = store()
        val hotp = OtpAccount(type = OtpType.hotp, issuer = "H", account = "h", secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")
        s.add(listOf(hotp), "qr")
        val id = s.accounts[0].id
        assertEquals("755224", s.takeHotpCode(id)) // RFC 4226, counter 0
        assertEquals("287082", s.takeHotpCode(id)) // counter 1
        assertEquals(2L, s.accounts[0].otp.counter)
    }

    @Test fun movesAndRenames() {
        val s = store()
        val bob = OtpAccount(issuer = "Other", account = "bob", secret = "MFRGGZDFMZTWQ2LK")
        s.add(listOf(alice, bob), "qr")
        s.move(1, 0)
        assertEquals(listOf("Other", "Example"), s.accounts.map { it.otp.issuer })
        s.rename(s.accounts[0].id, "  Renamed ", " bob@example.com ")
        assertEquals("Renamed", s.accounts[0].otp.issuer)
        assertEquals("bob@example.com", s.accounts[0].otp.account)
    }

    @Test fun encryptedBackupRoundTrip() {
        val s = store()
        s.add(listOf(alice), "qr")
        val file = Backup.encryptedFile(s.accounts, "correct horse", iterations = 1000)
        val content = Backup.read(file)
        assertTrue(content is Backup.Content.Encrypted)
        val vault = (content as Backup.Content.Encrypted).vault
        assertEquals(listOf(alice), Backup.restore(Backup.open(vault, "correct horse")))
        assertThrows(CoreError.WrongPassword::class.java) { Backup.open(vault, "wrong horse") }
    }

    @Test fun importBatchCollectsAGoogleExport() {
        val batch = ImportBatch()
        val other = OtpAccount(issuer = "Other", account = "bob", secret = "MFRGGZDFMZTWQ2LK")
        val first = Migration.build(listOf(alice), batchIndex = 0, batchSize = 2, batchId = 7)
        val second = Migration.build(listOf(other), batchIndex = 1, batchSize = 2, batchId = 7)
        assertTrue(batch.add(first))
        assertEquals(1 to 2, batch.pendingMigration)
        assertTrue(batch.add(first)) // the same QR again changes nothing
        assertEquals(1, batch.candidates.size)
        assertTrue(batch.add(second))
        assertNull(batch.pendingMigration)
        assertEquals(listOf(alice, other), batch.selectedAccounts)
        assertEquals("google", batch.source)
        assertFalse(batch.add("https://example.com"))
    }

    @Test fun lockComesBackOnlyAfterAMinuteInTheBackground() {
        val lock = AppLock(MemoryPrefs()) { true }
        assertTrue(lock.isLocked) // starts locked when the device has a screen lock
        val unlocked = AppLock(MemoryPrefs().apply { putBoolean("lockEnabled", false) }) { true }
        assertFalse(unlocked.isLocked)
        unlocked.enabled = true
        unlocked.onBackground(now = 0)
        unlocked.onForeground(now = AppLock.GRACE_MS) // exactly a minute: still open
        assertFalse(unlocked.isLocked)
        unlocked.onBackground(now = 0)
        unlocked.onForeground(now = AppLock.GRACE_MS + 1)
        assertTrue(unlocked.isLocked)
        assertFalse(AppLock(MemoryPrefs()) { false }.isLocked) // no screen lock: nothing to unlock with
    }
}
