package expo.modules.homewidgets

import android.content.Intent
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HomeWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HomeWidgets")

    /** Replaces the Today widget's data with [json] (see TodaySnapshot) and redraws every instance. */
    AsyncFunction("setTodaySnapshot") { json: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TodaySnapshotStore.write(context, json)
      TodayWidgetProvider.refreshAll(context)
    }

    /** Drops the Today widget's data — on sign-out, so a signed-out phone shows no finances. */
    AsyncFunction("clearTodaySnapshot") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TodaySnapshotStore.clear(context)
      TodayWidgetProvider.refreshAll(context)
    }

    /**
     * Sends the app to the background as if Home was pressed, keeping it alive so the next open is
     * instant. Used after a quick add launched from a widget.
     */
    AsyncFunction("moveToBackground") {
      appContext.currentActivity?.moveTaskToBack(true) ?: false
    }.runOnQueue(Queues.MAIN)

    /**
     * True when Android relaunched the app from Recents. It then replays the intent that first
     * started the task — possibly a quick add tapped long ago — rather than a fresh tap.
     */
    Function("launchedFromHistory") {
      val flags = appContext.currentActivity?.intent?.flags ?: 0
      (flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
    }
  }
}
