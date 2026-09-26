import { useCallback, useMemo, useSyncExternalStore } from "react";
import { Directory, File, Paths } from "expo-file-system";
import { api, onTransactionWrite } from "../api/client";
import { getErrorMessage } from "../api/errors";
import type { Transaction, TransactionType } from "../api/types";
import { decryptedCopy, getKeyVersion, subscribeKeys } from "../api/vaultSession";

/**
 * The family's transactions, kept on the device. Screens read (and filter) the local copy, so they
 * show straight away, while a delta sync fetches only what changed since last time
 * (GET /transactions/sync) and folds it in. Rows are stored as the server holds them: payee/notes
 * stay sealed on disk and are decrypted in memory when read, and only for the rows a screen asks for.
 */

// Bump when the stored shape changes; an old file is then ignored and fetched again from scratch.
const FORMAT = 1;
// Returning to a screen syncs at most this often; saves, SMS imports and repeating payments sync at once.
const MIN_INTERVAL_MS = 5000;

interface SyncResponse {
  transactions: Transaction[];
  removed: string[];
  scope: string;
  since: string | null;
  hasMore: boolean;
}

interface Persisted {
  format: number;
  userId: string;
  familyId: string;
  since: string | null;
  scope: string | null;
  rows: Transaction[];
}

interface FamilyCache {
  userId: string;
  familyId: string;
  /** By id, payee/notes still sealed. */
  rows: Map<string, Transaction>;
  since: string | null;
  scope: string | null;
  /** Has a complete copy (from disk or a finished first sync). */
  ready: boolean;
  error: string | null;
  version: number;
  syncing: Promise<void> | null;
  syncAgain: boolean;
  lastSyncedAt: number;
  /** This device's own saves while a sync is running, re-applied on top of what it brings back. */
  localWrites: Map<string, Transaction | null> | null;
  /** Newest first, rebuilt lazily after a change. */
  sorted: Transaction[] | null;
  decrypted: Map<string, { source: Transaction; keyVersion: number; value: Transaction }>;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

const caches = new Map<string, FamilyCache>();
const listeners = new Set<() => void>();

function notify(cache: FamilyCache) {
  cache.version++;
  cache.sorted = null;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const unsubscribeKeys = subscribeKeys(listener);
  return () => {
    listeners.delete(listener);
    unsubscribeKeys();
  };
}

// ---- disk ----------------------------------------------------------------------------------

function cacheDir() {
  return new Directory(Paths.document, "transactions");
}

function cacheFile(userId: string, familyId: string) {
  return new File(cacheDir(), `${userId}-${familyId}.json`);
}

function readPersisted(userId: string, familyId: string): Persisted | null {
  try {
    const file = cacheFile(userId, familyId);
    if (!file.exists) return null;
    const data = JSON.parse(file.textSync()) as Persisted;
    if (data.format !== FORMAT || data.userId !== userId || data.familyId !== familyId || !Array.isArray(data.rows)) return null;
    return data;
  } catch {
    return null;
  }
}

function persistSoon(cache: FamilyCache) {
  if (cache.persistTimer) clearTimeout(cache.persistTimer);
  cache.persistTimer = setTimeout(() => {
    cache.persistTimer = null;
    if (caches.get(key(cache.userId, cache.familyId)) !== cache) return;
    try {
      const dir = cacheDir();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const data: Persisted = {
        format: FORMAT,
        userId: cache.userId,
        familyId: cache.familyId,
        since: cache.since,
        scope: cache.scope,
        rows: Array.from(cache.rows.values()),
      };
      const file = cacheFile(cache.userId, cache.familyId);
      if (!file.exists) file.create();
      file.write(JSON.stringify(data));
    } catch {
      // Only a cache: the next launch fetches everything again.
    }
  }, 500);
}

/** Forgets every stored copy (sign-out, or the session ending). */
export function clearTransactionCache() {
  for (const cache of caches.values()) {
    if (cache.persistTimer) clearTimeout(cache.persistTimer);
  }
  caches.clear();
  try {
    const dir = cacheDir();
    if (dir.exists) dir.delete();
  } catch {
    // Nothing more to do.
  }
  listeners.forEach((l) => l());
}

// ---- cache ---------------------------------------------------------------------------------

function key(userId: string, familyId: string) {
  return `${userId}:${familyId}`;
}

function getCache(userId: string, familyId: string): FamilyCache {
  const k = key(userId, familyId);
  let cache = caches.get(k);
  if (!cache) {
    const stored = readPersisted(userId, familyId);
    cache = {
      userId,
      familyId,
      rows: new Map(stored?.rows.map((t) => [t.id, t]) ?? []),
      since: stored?.since ?? null,
      scope: stored?.scope ?? null,
      ready: !!stored,
      error: null,
      version: 0,
      syncing: null,
      syncAgain: false,
      lastSyncedAt: 0,
      localWrites: null,
      sorted: null,
      decrypted: new Map(),
      persistTimer: null,
    };
    caches.set(k, cache);
  }
  return cache;
}

function sortedRows(cache: FamilyCache): Transaction[] {
  if (!cache.sorted) {
    // Same order as the list endpoint: newest date first, then newest entry first.
    cache.sorted = Array.from(cache.rows.values()).sort((a, b) =>
      a.date === b.date ? (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) : a.date < b.date ? 1 : -1
    );
  }
  return cache.sorted;
}

function readable(cache: FamilyCache, row: Transaction): Transaction {
  const keyVersion = getKeyVersion();
  const memo = cache.decrypted.get(row.id);
  if (memo && memo.source === row && memo.keyVersion === keyVersion) return memo.value;
  const value = decryptedCopy(row);
  cache.decrypted.set(row.id, { source: row, keyVersion, value });
  return value;
}

// This device's own saves show up at once, before any sync.
onTransactionWrite((write) => {
  for (const cache of caches.values()) {
    if (cache.familyId !== write.familyId) continue;
    const id = "saved" in write ? String(write.saved.id) : write.deletedId;
    const row = "saved" in write ? (write.saved as unknown as Transaction) : null;
    if (row) cache.rows.set(id, row);
    else cache.rows.delete(id);
    cache.localWrites?.set(id, row);
    notify(cache);
    persistSoon(cache);
  }
});

// ---- sync ----------------------------------------------------------------------------------

async function runSync(cache: FamilyCache) {
  const url = `/families/${cache.familyId}/transactions/sync`;
  let since = cache.since;
  let continuing = false;
  let next = since ? new Map(cache.rows) : new Map<string, Transaction>();
  let scope: string | null = null;
  let changed = !cache.ready;

  for (;;) {
    const res = await api.get<SyncResponse>(url, { params: { ...(since ? { since } : {}), ...(continuing ? { continue: "1" } : {}) } });
    const page = res.data;
    if (scope === null) {
      scope = page.scope;
      // An account or category changed (a rename, one going private): every row may carry the old
      // name, or not belong here any more. Start over; the copy on screen stays until that's done.
      if (since && cache.scope !== null && page.scope !== cache.scope) {
        since = null;
        continuing = false;
        next = new Map();
        changed = true;
        continue;
      }
    }
    for (const id of page.removed) changed = next.delete(id) || changed;
    for (const t of page.transactions) {
      // The overlap re-sends rows already held; an unchanged one keeps its object (and its render).
      if (next.get(t.id)?.updatedAt === t.updatedAt) continue;
      next.set(t.id, t);
      changed = true;
    }
    since = page.since;
    if (!page.hasMore) break;
    continuing = true;
  }

  cache.lastSyncedAt = Date.now();
  const hadError = cache.error !== null;
  cache.error = null;
  if (!changed && since === cache.since) {
    if (hadError) notify(cache);
    return;
  }

  // Saves made on this device while the sync ran win over older copies it brought back.
  for (const [id, row] of cache.localWrites ?? []) {
    if (!row) next.delete(id);
    else {
      const synced = next.get(id);
      if (!synced || synced.updatedAt <= row.updatedAt) next.set(id, row);
    }
  }

  cache.rows = next;
  cache.since = since;
  cache.scope = scope;
  cache.ready = true;
  persistSoon(cache);
  if (changed) notify(cache);
}

function startSync(cache: FamilyCache): Promise<void> {
  if (cache.syncing) {
    // Something changed after the running sync asked; go round once more when it's done.
    cache.syncAgain = true;
    return cache.syncing;
  }
  cache.localWrites = new Map();
  cache.syncing = (async () => {
    try {
      do {
        cache.syncAgain = false;
        await runSync(cache);
      } while (cache.syncAgain);
    } catch (err) {
      cache.error = getErrorMessage(err, "Unable to load transactions");
      notify(cache);
    } finally {
      cache.syncing = null;
      cache.localWrites = null;
    }
  })();
  return cache.syncing;
}

/**
 * Brings the local copy up to date. Without `force`, skipped when it was synced moments ago (tab
 * switches); pass it when something is known to have changed on the server.
 */
export function syncTransactions(userId: string, familyId: string, { force = false } = {}): Promise<void> {
  const cache = getCache(userId, familyId);
  if (!force && !cache.syncing && cache.ready && Date.now() - cache.lastSyncedAt < MIN_INTERVAL_MS) return Promise.resolve();
  return startSync(cache);
}

// ---- reading -------------------------------------------------------------------------------

export interface TransactionFilter {
  /** Inclusive. */
  from?: Date;
  /** Exclusive, like the list endpoint. */
  to?: Date;
  /** Either leg: what the account paid out and the transfers that landed on it. */
  accountId?: string;
  type?: TransactionType;
  /** For sums that never show payee/notes: skips decrypting them. */
  sealed?: boolean;
}

/** The matching transactions, newest first, with payee/notes decrypted. */
export function selectTransactions(userId: string, familyId: string, filter: TransactionFilter = {}): Transaction[] {
  const cache = getCache(userId, familyId);
  const from = filter.from?.toISOString();
  const to = filter.to?.toISOString();
  const out: Transaction[] = [];
  for (const t of sortedRows(cache)) {
    if (to && t.date >= to) continue;
    if (from && t.date < from) break;
    if (filter.type && t.type !== filter.type) continue;
    if (filter.accountId && t.accountId !== filter.accountId && t.transferToAccountId !== filter.accountId) continue;
    out.push(filter.sealed ? t : readable(cache, t));
  }
  return out;
}

/**
 * The local copy, filtered. `ready` is false only until the first copy exists — after that the
 * screen shows what's stored while syncs run behind it. Pass `null` to read nothing (yet).
 */
export function useTransactions(userId: string, familyId: string, filter: TransactionFilter | null) {
  const cache = getCache(userId, familyId);
  const snapshot = useSyncExternalStore(subscribe, () => `${cache.version}:${getKeyVersion()}:${caches.size}`);

  const fromMs = filter?.from?.getTime();
  const toMs = filter?.to?.getTime();
  const enabled = filter !== null;
  const accountId = filter?.accountId;
  const type = filter?.type;
  const sealed = filter?.sealed;
  const transactions = useMemo(
    () =>
      enabled
        ? selectTransactions(userId, familyId, {
            from: fromMs === undefined ? undefined : new Date(fromMs),
            to: toMs === undefined ? undefined : new Date(toMs),
            accountId,
            type,
            sealed,
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, userId, familyId, enabled, fromMs, toMs, accountId, type, sealed]
  );

  const sync = useCallback((options?: { force?: boolean }) => syncTransactions(userId, familyId, options), [userId, familyId]);

  return { transactions, ready: cache.ready, error: cache.error, sync };
}
