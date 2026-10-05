import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { formatCurrency } from "./format";
import { isUncategorized } from "./payeeRules";
import { selectTransactions } from "./transactionStore";

/**
 * The end-of-day nudge: "3 transactions today have no category". A local notification is scheduled
 * for the chosen time with today's count, and re-scheduled (or cancelled) whenever that count may
 * have changed — a save in the app, an SMS import, the periodic background sync. So what it says at
 * 9 PM is what the phone last knew, without needing anything to run at 9 PM itself.
 */

export interface ReminderSettings {
  enabled: boolean;
  /** Local time, 24-hour. */
  hour: number;
  minute: number;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: true, hour: 21, minute: 0 };

// SecureStore keys may only contain [A-Za-z0-9._-].
const SETTINGS_KEY = "familyFinance.uncategorizedReminder";
const ASKED_KEY = "familyFinance.uncategorizedReminder.asked";
export const REMINDER_CHANNEL_ID = "daily-reminders";
// Fixed, so each schedule replaces the last instead of stacking up.
const REMINDER_ID = "uncategorized-reminder";
export const REMINDER_NOTIFICATION_TYPE = "uncategorized";

export async function loadReminderSettings(): Promise<ReminderSettings> {
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
      if (parsed && typeof parsed === "object") return { ...DEFAULT_REMINDER_SETTINGS, ...parsed };
    }
  } catch {
    // Corrupt blob — defaults.
  }
  return DEFAULT_REMINDER_SETTINGS;
}

export async function saveReminderSettings(settings: ReminderSettings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings)).catch(() => undefined);
}

export function formatReminderTime({ hour, minute }: Pick<ReminderSettings, "hour" | "minute">) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * Whether notifications may be shown. With `ask`, asks the user — but only the first time this
 * reminder needs it, so turning it on (or the first launch with it on) is the one prompt.
 */
export async function ensureReminderPermission({ ask = false, force = false } = {}): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
        name: "Daily reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    if (!ask || !existing.canAskAgain) return false;
    if (!force && (await SecureStore.getItemAsync(ASKED_KEY).catch(() => null))) return false;
    await SecureStore.setItemAsync(ASKED_KEY, "1").catch(() => undefined);
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

function cancelReminder() {
  return Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => undefined);
}

/** Today's (local) transactions this user recorded that still have no category. */
export function uncategorizedToday(userId: string, familyId: string, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return selectTransactions(userId, familyId, { from, to, sealed: true }).filter((t) => t.userId === userId && isUncategorized(t));
}

/**
 * Schedules tonight's reminder from the transactions held on this device, or cancels it when there's
 * nothing to sort out (or it's switched off). Safe to call often, from the app or a background task.
 */
export async function refreshUncategorizedReminder(userId: string, familyId: string, currency: string): Promise<void> {
  try {
    const settings = await loadReminderSettings();
    if (!settings.enabled || !(await ensureReminderPermission())) {
      await cancelReminder();
      return;
    }

    const now = new Date();
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), settings.hour, settings.minute);
    // Already past tonight's time: that one has gone out (or had nothing to say). Tomorrow's is
    // scheduled once tomorrow brings transactions.
    if (at.getTime() <= now.getTime()) {
      await cancelReminder();
      return;
    }

    const pending = uncategorizedToday(userId, familyId, now);
    if (pending.length === 0) {
      await cancelReminder();
      return;
    }

    const expenses = pending.filter((t) => t.type === "EXPENSE").reduce((sum, t) => sum + t.amount, 0);
    const count = pending.length;
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: {
        title: count === 1 ? "1 transaction needs a category" : `${count} transactions need a category`,
        body:
          (expenses > 0 ? `${formatCurrency(expenses, currency)} spent today isn't categorised yet. ` : "Today's entries aren't categorised yet. ") +
          "Tap to sort them out.",
        data: { type: REMINDER_NOTIFICATION_TYPE },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        ...(Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {}),
      },
    });
  } catch {
    // Best effort — the next refresh tries again.
  }
}
