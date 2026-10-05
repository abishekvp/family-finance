package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.facebook.react.HeadlessJsTaskService

/**
 * Wakes the JS engine to re-scan the SMS inbox as soon as a message arrives, even if the app is
 * closed — see the "SmsSyncTask" headless task registered in mobile/index.js and defined in
 * mobile/src/tasks/smsHeadlessTask.ts. Handling this broadcast puts the app on Android's temporary
 * background-start allowlist, so starting a plain (non-foreground) service here is allowed without a
 * persistent notification; see SmsHeadlessTaskService.
 */
class SmsReceivedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    // Recommended by HeadlessJsTaskService's own docs when started from a receiver: the device
    // could otherwise fall asleep in the moment between startService() returning here and the
    // service actually starting the task.
    HeadlessJsTaskService.acquireWakeLockNow(context)
    try {
      context.startService(Intent(context, SmsHeadlessTaskService::class.java))
    } catch (e: IllegalStateException) {
      // Some OEM builds refuse background service starts even for SMS broadcasts. Nothing is lost:
      // the next app open or periodic background sync scans past the same watermark.
    } catch (e: SecurityException) {
    }
  }
}
