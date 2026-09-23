package expo.modules.homewidgets

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal data class TodayItem(val title: String, val subtitle: String, val amount: String, val kind: String)

/**
 * What the Today widget shows. Built by the app (src/lib/todayWidget.ts) — transactions are
 * end-to-end encrypted and only the JS side holds the key — so every amount arrives already
 * formatted in the family's currency.
 */
internal data class TodaySnapshot(
  /** Local calendar day the data is for, yyyy-MM-dd. */
  val day: String,
  val spent: String,
  val income: String,
  /** Zero in the family's currency, shown once the day has rolled over and nothing is known yet. */
  val zero: String,
  val items: List<TodayItem>
) {
  val isForToday: Boolean
    get() = day == TodaySnapshotStore.today()

  companion object {
    fun parse(json: String): TodaySnapshot {
      val root = JSONObject(json)
      val items = root.getJSONArray("items")
      return TodaySnapshot(
        day = root.getString("day"),
        spent = root.getString("spent"),
        income = root.getString("income"),
        zero = root.getString("zero"),
        items = List(items.length()) { i ->
          val item = items.getJSONObject(i)
          TodayItem(
            title = item.getString("title"),
            subtitle = item.optString("subtitle", ""),
            amount = item.getString("amount"),
            kind = item.getString("kind")
          )
        }
      )
    }
  }
}

internal object TodaySnapshotStore {
  // noBackupFilesDir: the snapshot holds decrypted payees, which must not ride along in cloud backups.
  private fun file(context: Context) = AtomicFile(File(context.noBackupFilesDir, "today_widget.json"))

  fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  fun write(context: Context, json: String) {
    // Reject malformed input here rather than having every widget redraw fail on it later.
    TodaySnapshot.parse(json)
    val file = file(context)
    val stream = file.startWrite()
    try {
      stream.write(json.toByteArray(Charsets.UTF_8))
      file.finishWrite(stream)
    } catch (e: Exception) {
      file.failWrite(stream)
      throw e
    }
  }

  fun clear(context: Context) {
    file(context).delete()
  }

  fun read(context: Context): TodaySnapshot? =
    try {
      TodaySnapshot.parse(String(file(context).readFully(), Charsets.UTF_8))
    } catch (e: Exception) {
      null
    }
}
