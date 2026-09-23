import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../context/AuthContext";
import { useSmsImport } from "../context/SmsImportContext";
import { refreshTodayWidget } from "../lib/todayWidget";

/**
 * Keeps the "Today" home-screen widget current: on launch, whenever the app returns to the
 * foreground, and after an SMS scan records something. Saves and deletes in the transaction form
 * refresh it directly.
 */
export function TodayWidgetSync() {
  const { user } = useAuth();
  const family = user?.families[0];
  const familyId = family?.id;
  const currency = family?.currency;
  const { syncVersion } = useSmsImport();

  useEffect(() => {
    if (!familyId || !currency) return;
    refreshTodayWidget(familyId, currency);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshTodayWidget(familyId, currency);
    });
    return () => sub.remove();
  }, [familyId, currency, syncVersion]);

  return null;
}
