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
      20000, // ms — one network round trip to sync, generous but bounded
      false // not allowed to promote itself to a foreground service
    )
  }
}
