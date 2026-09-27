import { api, refreshAccessToken } from "../api/client";
import { isSmsReaderAvailable } from "../../modules/sms-reader";
import { loadSmsSettings, saveSmsSettings, syncSmsTransactions } from "../lib/smsImport";

/**
 * Runs when the native SMS receiver (see the sms-reader module's SmsReceivedReceiver.kt) wakes the
 * JS engine for a just-arrived SMS — including when the app isn't running at all, in which case this
 * executes in a fresh JS context with no React tree and no signed-in session held in memory. So it
 * re-derives everything it needs from persisted storage, the same way AuthProvider bootstraps on a
 * cold launch, rather than assuming any app state already exists.
 */
export default async function smsHeadlessTask(): Promise<void> {
  if (!isSmsReaderAvailable()) return;
  try {
    const token = await refreshAccessToken();
    if (!token) return;

    const me = await api.get("/auth/me");
    const familyId = me.data?.families?.[0]?.id as string | undefined;
    if (!familyId) return;

    const settings = await loadSmsSettings(familyId);
    if (!settings.enabled) return;

    const { settings: next } = await syncSmsTransactions(familyId, settings);
    await saveSmsSettings(next);
  } catch {
    // Best-effort wake-up — the next foreground open or periodic background sync retries.
  }
}
