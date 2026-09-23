import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";

export interface TodayWidgetItem {
  title: string;
  subtitle: string;
  /** Already formatted, with sign — the widget shows it verbatim. */
  amount: string;
  kind: "INCOME" | "EXPENSE" | "TRANSFER";
}

export interface TodayWidgetSnapshot {
  /** Local calendar day, yyyy-MM-dd. The widget ignores a snapshot from another day. */
  day: string;
  spent: string;
  income: string;
  /** Zero in the family's currency, for the widget to show after midnight until the app refreshes it. */
  zero: string;
  items: TodayWidgetItem[];
}

interface HomeWidgetsNative {
  setTodaySnapshot(json: string): Promise<void>;
  clearTodaySnapshot(): Promise<void>;
  moveToBackground(): Promise<boolean>;
}

// Null on iOS, web, Expo Go, and builds that predate the widgets, so every call is a no-op there.
const native = Platform.OS === "android" ? requireOptionalNativeModule<HomeWidgetsNative>("HomeWidgets") : null;

export async function setTodaySnapshot(snapshot: TodayWidgetSnapshot) {
  await native?.setTodaySnapshot(JSON.stringify(snapshot));
}

export async function clearTodaySnapshot() {
  await native?.clearTodaySnapshot();
}

/** Sends the app to the background (like pressing Home). Resolves false where that isn't possible. */
export async function moveToBackground() {
  return (await native?.moveToBackground()) ?? false;
}
