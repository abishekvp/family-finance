package expo.modules.homewidgets

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

internal object WidgetLinks {
  // Must match `expo.scheme` in app.json.
  private const val SCHEME = "familyfinance"

  /**
   * Opens the add-transaction form preset to [type]. `source=widget` tells the form to send the
   * app back to the home screen after saving, instead of leaving it open.
   */
  fun addTransaction(context: Context, type: String, requestCode: Int): PendingIntent {
    val uri = Uri.parse("$SCHEME://transaction-form?type=$type&source=widget")
    val intent = Intent(Intent.ACTION_VIEW, uri)
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Brings the app forward on whatever screen it was last on. */
  fun openApp(context: Context, requestCode: Int, mutable: Boolean = false): PendingIntent {
    val intent = (context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent())
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // A collection's click template must be mutable on S+ so each row's fill-in intent can merge in.
    val mutability =
      if (mutable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or mutability)
  }
}
