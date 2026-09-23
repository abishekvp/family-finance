package expo.modules.homewidgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews

/** One-tap buttons that open the add-transaction form preset to expense, income or transfer. */
class QuickAddWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) {
      val views = RemoteViews(context.packageName, R.layout.ff_widget_quick_add)
      views.setOnClickPendingIntent(R.id.ff_quick_expense, WidgetLinks.addTransaction(context, "EXPENSE", REQUEST_EXPENSE))
      views.setOnClickPendingIntent(R.id.ff_quick_income, WidgetLinks.addTransaction(context, "INCOME", REQUEST_INCOME))
      views.setOnClickPendingIntent(R.id.ff_quick_transfer, WidgetLinks.addTransaction(context, "TRANSFER", REQUEST_TRANSFER))
      appWidgetManager.updateAppWidget(id, views)
    }
  }

  private companion object {
    const val REQUEST_EXPENSE = 200
    const val REQUEST_INCOME = 201
    const val REQUEST_TRANSFER = 202
  }
}
