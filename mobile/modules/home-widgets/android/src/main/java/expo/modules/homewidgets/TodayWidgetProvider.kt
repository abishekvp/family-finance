package expo.modules.homewidgets

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/** Today's spent / income totals and the day's transactions, from the snapshot the app last wrote. */
class TodayWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    update(context, appWidgetManager, appWidgetIds)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_MIDNIGHT, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> refreshAll(context)
    }
  }

  override fun onDisabled(context: Context) {
    context.getSystemService(AlarmManager::class.java)?.cancel(midnightIntent(context))
  }

  companion object {
    private const val ACTION_MIDNIGHT = "expo.modules.homewidgets.action.TODAY_MIDNIGHT"
    private const val REQUEST_OPEN = 100
    private const val REQUEST_ADD = 101
    private const val REQUEST_ROW = 102
    private const val REQUEST_MIDNIGHT = 103

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, TodayWidgetProvider::class.java))
      if (ids.isNotEmpty()) update(context, manager, ids)
    }

    @Suppress("DEPRECATION") // setRemoteAdapter(Intent) / notifyAppWidgetViewDataChanged still work; their replacement is API 31+.
    private fun update(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val snapshot = TodaySnapshotStore.read(context)
      for (id in ids) {
        val views = RemoteViews(context.packageName, R.layout.ff_widget_today)
        bindSummary(context, views, snapshot)

        val adapter = Intent(context, TodayWidgetService::class.java)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
        // Unique data per widget, or the system hands every instance the same cached factory.
        adapter.data = Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME))
        views.setRemoteAdapter(R.id.ff_today_list, adapter)
        views.setEmptyView(R.id.ff_today_list, R.id.ff_today_empty)
        views.setPendingIntentTemplate(R.id.ff_today_list, WidgetLinks.openApp(context, REQUEST_ROW, mutable = true))

        views.setOnClickPendingIntent(R.id.ff_today_header, WidgetLinks.openApp(context, REQUEST_OPEN))
        views.setOnClickPendingIntent(R.id.ff_today_totals, WidgetLinks.openApp(context, REQUEST_OPEN))
        views.setOnClickPendingIntent(R.id.ff_today_empty, WidgetLinks.openApp(context, REQUEST_OPEN))
        views.setOnClickPendingIntent(R.id.ff_today_add, WidgetLinks.addTransaction(context, "EXPENSE", REQUEST_ADD))

        manager.updateAppWidget(id, views)
      }
      manager.notifyAppWidgetViewDataChanged(ids, R.id.ff_today_list)
      scheduleMidnightRefresh(context)
    }

    private fun bindSummary(context: Context, views: RemoteViews, snapshot: TodaySnapshot?) {
      views.setTextViewText(R.id.ff_today_date, SimpleDateFormat("EEE, d MMM", Locale.getDefault()).format(Date()))

      val count = if (snapshot?.isForToday == true) snapshot.items.size else 0
      if (count > 0) {
        views.setTextViewText(R.id.ff_today_count, context.resources.getQuantityString(R.plurals.ff_widget_count, count, count))
        views.setViewVisibility(R.id.ff_today_count, View.VISIBLE)
      } else {
        views.setViewVisibility(R.id.ff_today_count, View.GONE)
      }

      when {
        snapshot == null -> {
          views.setTextViewText(R.id.ff_today_spent, "—")
          views.setTextViewText(R.id.ff_today_income, "—")
          views.setTextViewText(R.id.ff_today_empty, context.getString(R.string.ff_widget_signed_out))
        }
        // Past midnight with no fresh data from the app yet: yesterday's numbers would be wrong.
        !snapshot.isForToday -> {
          views.setTextViewText(R.id.ff_today_spent, snapshot.zero)
          views.setTextViewText(R.id.ff_today_income, snapshot.zero)
          views.setTextViewText(R.id.ff_today_empty, context.getString(R.string.ff_widget_empty_today))
        }
        else -> {
          views.setTextViewText(R.id.ff_today_spent, snapshot.spent)
          views.setTextViewText(R.id.ff_today_income, snapshot.income)
          views.setTextViewText(R.id.ff_today_empty, context.getString(R.string.ff_widget_empty_today))
        }
      }
    }

    private fun midnightIntent(context: Context): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        REQUEST_MIDNIGHT,
        Intent(context, TodayWidgetProvider::class.java).setAction(ACTION_MIDNIGHT),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

    /**
     * Inexact, non-waking alarm just after midnight so the widget stops showing yesterday. Needs no
     * exact-alarm permission; if the phone is asleep it simply fires on the next wake.
     */
    private fun scheduleMidnightRefresh(context: Context) {
      val alarms = context.getSystemService(AlarmManager::class.java) ?: return
      val next = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, 1)
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 5)
        set(Calendar.MILLISECOND, 0)
      }
      alarms.set(AlarmManager.RTC, next.timeInMillis, midnightIntent(context))
    }
  }
}
