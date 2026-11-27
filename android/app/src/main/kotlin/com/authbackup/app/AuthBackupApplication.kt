package com.authbackup.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.authbackup.app.model.AppLock
import com.authbackup.app.model.KeyStore
import com.authbackup.app.model.KeystoreFileStore
import com.authbackup.app.model.SharedPrefs

/** One key list and one lock for the whole process. */
class AuthBackupApplication : Application() {
    lateinit var store: KeyStore
        private set
    lateinit var lock: AppLock
        private set

    override fun onCreate() {
        super.onCreate()
        val prefs = SharedPrefs(this)
        store = KeyStore(KeystoreFileStore(this), prefs)
        lock = AppLock(prefs) { AppLock.canAuthenticate(this) }
        // The app as a whole going to the background, not one screen: the lock's one-minute grace starts here.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStop(owner: LifecycleOwner) = lock.onBackground()
            override fun onStart(owner: LifecycleOwner) = lock.onForeground()
        })
    }
}
