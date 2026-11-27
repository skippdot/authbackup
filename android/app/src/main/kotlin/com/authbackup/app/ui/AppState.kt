package com.authbackup.app.ui

import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import com.authbackup.app.model.ImportBatch

/** The screens. Codes is always at the bottom of the stack. */
sealed interface Route {
    data object Codes : Route
    data object Add : Route
    data object Scanner : Route
    data object Preview : Route
    data object Manual : Route
    data class Detail(val id: String) : Route
    data object Settings : Route
    data object BackupExport : Route
    data object GoogleExport : Route
}

/** Navigation and the import in progress; a ViewModel, so both survive rotation. */
class AppState : ViewModel() {
    val stack = mutableStateListOf<Route>(Route.Codes)
    val snackbar = SnackbarHostState()
    var batch = ImportBatch()

    val top get() = stack.last()

    fun push(route: Route) {
        stack += route
    }

    fun back() {
        if (stack.size > 1) stack.removeAt(stack.lastIndex)
    }

    /** Replaces everything above [base] (the add screen, for example) with [route]. */
    fun replaceAbove(base: Route, route: Route) {
        val i = stack.indexOf(base)
        while (stack.size > i + 1) stack.removeAt(stack.lastIndex)
        stack += route
    }

    /** Back to the codes with a message ("Added 3 keys"). */
    fun finish(message: String?) {
        while (stack.size > 1) stack.removeAt(stack.lastIndex)
        pending = message
    }

    /** Shown by the codes screen once it is in front again. */
    var pending by mutableStateOf<String?>(null)
}
