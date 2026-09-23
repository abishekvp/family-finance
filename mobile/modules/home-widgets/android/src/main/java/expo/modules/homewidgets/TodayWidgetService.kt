package expo.modules.homewidgets

import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService

/** Rows for the Today widget's list. Reads the same snapshot file as the provider. */
class TodayWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Factory(applicationContext)

  private class Factory(private val context: Context) : RemoteViewsFactory {
    private var items: List<TodayItem> = emptyList()

    override fun onCreate() = Unit

    override fun onDataSetChanged() {
      val snapshot = TodaySnapshotStore.read(context)
      items = if (snapshot?.isForToday == true) snapshot.items else emptyList()
    }

    override fun onDestroy() {
      items = emptyList()
    }

    override fun getCount() = items.size

    override fun getViewAt(position: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.ff_widget_today_item)
      val item = items.getOrNull(position) ?: return views

      views.setTextViewText(R.id.ff_item_title, item.title)
      views.setTextViewText(R.id.ff_item_subtitle, item.subtitle)
      views.setViewVisibility(R.id.ff_item_subtitle, if (item.subtitle.isBlank()) View.GONE else View.VISIBLE)

      // One TextView per tone, so the colours come from resources and follow the launcher's dark mode.
      val amountViews = mapOf(
        "EXPENSE" to R.id.ff_item_amount_expense,
        "INCOME" to R.id.ff_item_amount_income,
        "TRANSFER" to R.id.ff_item_amount_transfer
      )
      val shown = amountViews[item.kind] ?: R.id.ff_item_amount_transfer
      for (viewId in amountViews.values) {
        views.setViewVisibility(viewId, if (viewId == shown) View.VISIBLE else View.GONE)
      }
      views.setTextViewText(shown, item.amount)

      views.setOnClickFillInIntent(R.id.ff_item_root, Intent())
      return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount() = 1

    override fun getItemId(position: Int) = position.toLong()

    override fun hasStableIds() = false
  }
}
