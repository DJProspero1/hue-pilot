package pt.prospero.huepilot.widget

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicLong

/**
 * Re-renders every placed widget of every kind. Calls are coalesced: while an update runs, further
 * requests wait for it and then run at most one more pass.
 */
object WidgetUpdater {
    private const val TAG = "WidgetUpdater"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val mutex = Mutex()
    private val requested = AtomicLong(0)
    private val completed = AtomicLong(0)

    /** Fire-and-forget update of all widgets. */
    fun updateAll(context: Context) {
        val app = context.applicationContext
        scope.launch { updateAllNow(app) }
    }

    /** Updates all widgets and returns when they have been re-rendered. */
    suspend fun updateAllNow(context: Context) {
        val app = context.applicationContext
        val mine = requested.incrementAndGet()
        mutex.withLock {
            // A pass that started after this request was made already reflects it.
            if (completed.get() >= mine) return
            val generation = requested.get()
            for (info in WidgetCatalog.all) {
                runCatching { info.widget().updateAll(app) }
                    .onFailure { Log.w(TAG, "update of ${info.id} failed", it) }
            }
            completed.set(generation)
        }
    }
}
