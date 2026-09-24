import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../context/AuthContext";
import { runRecurring } from "../lib/recurring";
import { refreshTodayWidget } from "../lib/todayWidget";

/**
 * Records repeating payments whose day has come: on launch, and whenever the app returns to the
 * foreground. There is no server-side scheduler, so this is what makes a salary or subscription
 * appear on its day.
 */
export function RecurringSync() {
  const { user } = useAuth();
  const family = user?.families[0];
  const familyId = family?.id;
  const currency = family?.currency;

  useEffect(() => {
    if (!familyId || !currency) return;
    const run = (force: boolean) =>
      runRecurring(familyId, { force }).then((posted) => {
        if (posted > 0) refreshTodayWidget(familyId, currency);
      });
    run(true);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run(false);
    });
    return () => sub.remove();
  }, [familyId, currency]);

  return null;
}
