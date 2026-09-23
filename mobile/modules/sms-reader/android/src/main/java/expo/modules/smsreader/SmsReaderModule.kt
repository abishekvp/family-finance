package expo.modules.smsreader

import android.Manifest
import android.content.pm.PackageManager
import android.provider.Telephony
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsPermissionException : CodedException("ERR_SMS_PERMISSION", "READ_SMS permission has not been granted", null)

class SmsReaderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    /**
     * Inbox messages received strictly after [sinceMs] (epoch millis), oldest first, capped at
     * [limit]. Oldest-first lets the caller advance its watermark message by message and resume
     * cleanly after a partial failure.
     */
    AsyncFunction("readInbox") { sinceMs: Double, limit: Int ->
      query("${Telephony.Sms.DATE} > ?", sinceMs, "${Telephony.Sms.DATE} ASC", limit)
    }

    /**
     * Inbox messages received strictly before [beforeMs], newest first, capped at [limit]. Used to
     * import history backwards from the moment SMS import was turned on, so the covered range
     * stays one contiguous span and an interrupted import resumes exactly where it stopped.
     */
    AsyncFunction("readInboxBefore") { beforeMs: Double, limit: Int ->
      query("${Telephony.Sms.DATE} < ?", beforeMs, "${Telephony.Sms.DATE} DESC", limit)
    }
  }

  private fun query(selection: String, boundMs: Double, sortOrder: String, limit: Int): List<Map<String, Any?>> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    if (context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
      throw SmsPermissionException()
    }

    val messages = mutableListOf<Map<String, Any?>>()
    val projection = arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      projection,
      selection,
      arrayOf(boundMs.toLong().toString()),
      sortOrder
    )?.use { cursor ->
      val idCol = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
      val addressCol = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
      val bodyCol = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
      val dateCol = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
      while (cursor.moveToNext() && messages.size < limit) {
        messages.add(
          mapOf(
            "id" to cursor.getLong(idCol).toString(),
            "address" to (cursor.getString(addressCol) ?: ""),
            "body" to (cursor.getString(bodyCol) ?: ""),
            "date" to cursor.getLong(dateCol).toDouble()
          )
        )
      }
    }
    return messages
  }
}
