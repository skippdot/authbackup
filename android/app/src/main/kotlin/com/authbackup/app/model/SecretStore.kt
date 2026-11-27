package com.authbackup.app.model

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import androidx.core.content.edit
import java.io.File
import java.io.FileNotFoundException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Where the key list is kept. The app uses an encrypted file; tests use memory. */
interface SecretStore {
    fun read(): ByteArray?
    fun write(data: ByteArray)
}

/**
 * The whole list in one file in `noBackupFilesDir`, encrypted with AES-GCM under a key that lives in the Android
 * Keystore. The key never leaves this device's secure hardware and works only while the device is unlocked, and the
 * file is excluded from Google and device-to-device backups (see the manifest). That is the Android counterpart of
 * the iOS app's this-device-only Keychain item: copies elsewhere are made on purpose, as encrypted backup files.
 */
class KeystoreFileStore(context: Context, name: String = "registry") : SecretStore {
    private val file = AtomicFile(File(context.noBackupFilesDir, "$name.bin"))
    private val alias = "com.authbackup.app.$name"

    override fun read(): ByteArray? {
        val blob = try {
            file.readFully()
        } catch (_: FileNotFoundException) {
            return null
        }
        require(blob.size > IV_BYTES) { "The key list file is damaged" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES))
        return cipher.doFinal(blob, IV_BYTES, blob.size - IV_BYTES)
    }

    override fun write(data: ByteArray) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key(create = true)) // the Keystore picks a fresh random IV
        val sealed = cipher.iv + cipher.doFinal(data)
        val out = file.startWrite()
        try {
            out.write(sealed)
            file.finishWrite(out)
        } catch (e: Exception) {
            file.failWrite(out)
            throw e
        }
    }

    /** The existing key; a new one only when writing, so a lost key is never replaced while a file still needs it. */
    private fun key(create: Boolean): SecretKey {
        val keyStore = java.security.KeyStore.getInstance(PROVIDER).apply { load(null) }
        (keyStore.getKey(alias, null) as SecretKey?)?.let { return it }
        check(create && !file.baseFile.exists()) { "The key for the key list is missing" }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUnlockedDeviceRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}

/** For tests. */
class MemoryStore(private var data: ByteArray? = null) : SecretStore {
    @Synchronized override fun read(): ByteArray? = data

    @Synchronized override fun write(data: ByteArray) {
        this.data = data
    }
}

/** Small settings that are not secret (the lock switch, the last backup date). */
interface Prefs {
    fun getLong(key: String): Long?
    fun putLong(key: String, value: Long)
    fun getBoolean(key: String): Boolean?
    fun putBoolean(key: String, value: Boolean)
}

class SharedPrefs(context: Context) : Prefs {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    override fun getLong(key: String) = if (prefs.contains(key)) prefs.getLong(key, 0) else null
    override fun putLong(key: String, value: Long) = prefs.edit { putLong(key, value) }
    override fun getBoolean(key: String) = if (prefs.contains(key)) prefs.getBoolean(key, false) else null
    override fun putBoolean(key: String, value: Boolean) = prefs.edit { putBoolean(key, value) }
}

class MemoryPrefs : Prefs {
    private val values = mutableMapOf<String, Any>()
    override fun getLong(key: String) = values[key] as Long?
    override fun putLong(key: String, value: Long) { values[key] = value }
    override fun getBoolean(key: String) = values[key] as Boolean?
    override fun putBoolean(key: String, value: Boolean) { values[key] = value }
}
