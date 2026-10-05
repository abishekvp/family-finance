import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../context/AuthContext";
import { href } from "../lib/nav";
import { useTransactions } from "../lib/transactionStore";
import {
  ensureReminderPermission,
  loadReminderSettings,
  refreshUncategorizedReminder,
  REMINDER_NOTIFICATION_TYPE,
} from "../lib/uncategorizedReminder";

// A burst of saves (an SMS catch-up, "file them all") re-schedules once.
const DEBOUNCE_MS = 1500;

/**
 * Keeps tonight's "needs a category" reminder in step with today's transactions while the app is
 * open, and opens the review screen when the reminder is tapped. The background sync and the SMS
 * wake-up do the same while the app is closed.
 */
export function UncategorizedReminderSync() {
  const { user } = useAuth();
  const router = useRouter();
  const family = user?.families[0];
  const userId = user?.id ?? "";
  const familyId = family?.id ?? "";
  const currency = family?.currency ?? "USD";

  // Asked once, the first time the reminder is on and the app opens (Android 13+ needs it).
  useEffect(() => {
    loadReminderSettings().then((s) => {
      if (s.enabled) ensureReminderPermission({ ask: true }).then(() => refreshUncategorizedReminder(userId, familyId, currency));
    });
  }, [userId, familyId, currency]);

  // Re-render (and so re-schedule) whenever today's rows change.
  const today = useMemo(() => {
    const now = new Date();
    return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), sealed: true };
  }, []);
  const { transactions } = useTransactions(userId, familyId, familyId ? today : null);

  useEffect(() => {
    if (!familyId) return;
    const timer = setTimeout(() => refreshUncategorizedReminder(userId, familyId, currency), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [transactions, userId, familyId, currency]);

  useEffect(() => {
    if (!familyId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshUncategorizedReminder(userId, familyId, currency);
    });
    return () => sub.remove();
  }, [userId, familyId, currency]);

  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (lastResponse?.notification.request.content.data?.type !== REMINDER_NOTIFICATION_TYPE) return;
    Notifications.clearLastNotificationResponse();
    router.push(href("/uncategorized"));
  }, [lastResponse, router]);

  return null;
}
