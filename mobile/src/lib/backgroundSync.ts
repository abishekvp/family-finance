import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { api, refreshAccessToken } from "../api/client";
import { isSmsReaderAvailable } from "../../modules/sms-reader";
import { runSmsSync } from "./smsImport";
import { syncTransactions } from "./transactionStore";
import { runRecurring } from "./recurring";

export const BACKGROUND_SYNC_TASK = "family-finance-background-sync";

// Registered here, at module scope, rather than inside registerBackgroundSync: expo-task-manager
// requires defineTask to run unconditionally as the bundle loads, since Android may launch this same
// JS bundle from scratch (no mounted app) just to run the task.
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async ({ error }) => {
  if (error) return BackgroundTask.BackgroundTaskResult.Failed;
  try {
    const token = await refreshAccessToken();
    if (!token) return BackgroundTask.BackgroundTaskResult.Failed;

    const me = await api.get("/auth/me");
    const userId = me.data?.id as string | undefined;
    const family = me.data?.families?.[0] as { id: string } | undefined;
    if (!userId || !family) return BackgroundTask.BackgroundTaskResult.Failed;

    // Recurring payments and the SMS catch-up scan never throw; the transaction sync might, so it's
    // last and wrapped by the outer try/catch.
    await runRecurring(family.id, { force: true });

    if (isSmsReaderAvailable()) await runSmsSync(family.id);

    await syncTransactions(userId, family.id, { force: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Turns the periodic sync on. Safe to call every time the app opens with a signed-in family — it's a
 * no-op once already registered. Android's WorkManager enforces a 15-minute floor on the interval
 * regardless of what's asked for, and may push runs out further under Doze or a vendor battery
 * optimiser; this is a supplement to (never a replacement for) syncing on launch/foreground.
 */
export async function registerBackgroundSync(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) return;
  await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, { minimumInterval: 15 }).catch(() => undefined);
}

export async function unregisterBackgroundSync(): Promise<void> {
  if (!(await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK))) return;
  await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK).catch(() => undefined);
}
