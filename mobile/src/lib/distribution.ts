import Constants from "expo-constants";

/**
 * How this build reached the phone (set at build time by app.config.js):
 *  - "direct": the APK from the website, which checks for and installs its own updates;
 *  - "play": installed from Google Play, which delivers updates itself — a Play app may not update
 *    itself any other way, so the in-app updater is off.
 */
export const DISTRIBUTION: "play" | "direct" = Constants.expoConfig?.extra?.distribution === "play" ? "play" : "direct";

export const SELF_UPDATES = DISTRIBUTION === "direct";

/** Whether this build includes recording transactions from bank SMS. */
export const SMS_FEATURE = Constants.expoConfig?.extra?.sms !== false;

/** The Play Store page for this app (opens the Play Store app when it's installed). */
export function playStoreUrl() {
  return `market://details?id=${Constants.expoConfig?.android?.package ?? ""}`;
}
