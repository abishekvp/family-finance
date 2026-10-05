package expo.modules.smsreader

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** Runs the "SmsSyncTask" headless JS task that SmsReceivedReceiver starts this service for. */
class SmsHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig {
    return HeadlessJsTaskConfig(
      "SmsSyncTask",
      Arguments.createMap(),
      // ms. The task waits for the messaging app to write the SMS to the inbox (it's broadcast
      // before that happens), then refreshes the session and records it: allow for a cold start.
      60000,
      // Must be true: with false, an SMS arriving while the app is open made the task refuse to
      // start (HeadlessJsTaskContext throws when the app is in the foreground). The task shares its
      // scan lock with the app's own scans, so running alongside them records nothing twice.
      true
    )
  }
}
