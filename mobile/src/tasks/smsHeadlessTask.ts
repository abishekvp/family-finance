import { api, refreshAccessToken } from "../api/client";
import { isSmsReaderAvailable } from "../../modules/sms-reader";
import { runSmsSync } from "../lib/smsImport";
import { refreshTodayWidget } from "../lib/todayWidget";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Android broadcasts SMS_RECEIVED before the messaging app has written the message to the inbox
// (it does that on its own SMS_DELIVER broadcast, a moment later), so the first look often finds
// nothing yet. Look again for a while; the native side gives this task 60 seconds.
const INBOX_RETRIES = 8;
const INBOX_RETRY_MS = 2500;

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
    const family = me.data?.families?.[0] as { id: string; currency: string; encryptionEnabled?: boolean } | undefined;
    if (!family?.id) return;

    for (let attempt = 0; attempt < INBOX_RETRIES; attempt++) {
      const { settings, result } = await runSmsSync(family.id);
      if (!settings.enabled || result.error) return;
      if ((result.scanned ?? 0) > 0) {
        // Payee names can't be read without the vault, which is locked while the app is closed.
        if (result.imported > 0 && !family.encryptionEnabled) refreshTodayWidget(family.id, family.currency);
        return;
      }
      await sleep(INBOX_RETRY_MS);
    }
  } catch {
    // Best-effort wake-up — the next foreground open or periodic background sync retries.
  }
}
