import * as SecureStore from "expo-secure-store";
import { api } from "../api/client";
import type { Transaction } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { hasSmsPermission, readInbox, readInboxBefore, type InboxSms } from "../../modules/sms-reader";
import { parseTransactionSms, type ParsedSms } from "./smsParser";

/** A transaction already recorded from SMS, kept to spot the same spend alerted twice. */
interface RecentImport {
  type: ParsedSms["type"];
  amount: number;
  hint: string | null;
  date: number;
}

export interface SmsImportSettings {
  enabled: boolean;
  /** Settings are per family — account ids from another family are meaningless. */
  familyId: string | null;
  defaultAccountId: string | null;
  /** Card / account last digits → app account id. Unmapped hints fall back to the default account. */
  accountMap: Record<string, string>;
  /** Last digits seen in alerts, newest first, so the user can map them. */
  seenHints: string[];
  /** Forward watermark: only messages received after this (epoch millis) are read. */
  since: number;
  /**
   * Backward watermark for the optional past-message import: every message from here up to
   * `since` has been handled. Starts at the moment import was turned on and only moves back when
   * the user asks for history. Null until import has been turned on.
   */
  historyFrom: number | null;
  recent: RecentImport[];
  lastRunAt: number | null;
  totalImported: number;
}

export interface SmsSyncResult {
  imported: number;
  /** Inbox messages read past the watermark, bank alerts or not. */
  scanned?: number;
  error: string | null;
}

export interface SmsHistoryResult extends SmsSyncResult {
  /** False when the run stopped at its page cap with older messages still to go. */
  complete: boolean;
}

// SecureStore keys may only contain [A-Za-z0-9._-].
const SETTINGS_KEY = "familyFinance.smsImport";
const MAX_RECENT = 60;
const MAX_HINTS = 12;
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
// History spans months of inbox, so it gets a bigger budget per run; it resumes where it stopped.
const MAX_HISTORY_PAGES = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
// The bank and the UPI app often both alert for one payment, minutes apart.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export const DEFAULT_SMS_SETTINGS: SmsImportSettings = {
  enabled: false,
  familyId: null,
  defaultAccountId: null,
  accountMap: {},
  seenHints: [],
  since: 0,
  historyFrom: null,
  recent: [],
  lastRunAt: null,
  totalImported: 0,
};

export async function loadSmsSettings(familyId: string): Promise<SmsImportSettings> {
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SmsImportSettings>;
      if (parsed && typeof parsed === "object" && parsed.familyId === familyId) {
        // Before the optional history import, turning SMS import on already pulled in past
        // messages. Mark history as handled so it can't be imported a second time.
        const migrated = parsed.historyFrom === undefined && parsed.enabled ? { historyFrom: 0 } : {};
        return { ...DEFAULT_SMS_SETTINGS, ...parsed, ...migrated };
      }
    }
  } catch {
    // Corrupt blob — start over rather than import against a bad watermark.
  }
  return { ...DEFAULT_SMS_SETTINGS, familyId };
}

export async function saveSmsSettings(settings: SmsImportSettings) {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(settings)).catch(() => undefined);
}

/**
 * Changes the user's choices on top of what's stored now — never on top of a copy held in memory,
 * whose watermark a background scan may have moved on since (writing it back would re-import).
 */
export async function patchSmsSettings(familyId: string, patch: Partial<SmsImportSettings>): Promise<SmsImportSettings> {
  const next = { ...(await loadSmsSettings(familyId)), ...patch, familyId };
  await saveSmsSettings(next);
  return next;
}

// Scans move the watermarks, so only one runs at a time in this JS runtime: the app's own scans, the
// SMS wake-up task and the periodic background sync all run here when the app is alive.
let scanLock: Promise<unknown> = Promise.resolve();
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = scanLock.then(run, run);
  scanLock = next.catch(() => undefined);
  return next;
}

/** Keeps choices the user made while a scan was running (they're stored straight away, see patchSmsSettings). */
async function saveScanResult(familyId: string, scanned: SmsImportSettings) {
  const latest = await loadSmsSettings(familyId);
  const merged = { ...scanned, enabled: latest.enabled, defaultAccountId: latest.defaultAccountId, accountMap: latest.accountMap };
  await saveSmsSettings(merged);
  return merged;
}

/**
 * Records new bank alerts: loads the stored settings, scans past the watermark and saves, as one
 * step. Every caller goes through here, so each scan starts from the latest watermark and no alert
 * is recorded twice, whichever of the app, the SMS wake-up or the background sync gets to it first.
 */
export function runSmsSync(familyId: string): Promise<{ settings: SmsImportSettings; result: SmsSyncResult }> {
  return exclusive(async () => {
    const settings = await loadSmsSettings(familyId);
    if (!settings.enabled) return { settings, result: { imported: 0, scanned: 0, error: null } };
    const { settings: next, result } = await syncSmsTransactions(familyId, settings);
    return { settings: await saveScanResult(familyId, next), result };
  });
}

/** The optional past-message import, under the same lock and rules as runSmsSync. */
export function runSmsHistoryImport(familyId: string, days: number): Promise<{ settings: SmsImportSettings; result: SmsHistoryResult }> {
  return exclusive(async () => {
    const settings = await loadSmsSettings(familyId);
    if (!settings.enabled) return { settings, result: { imported: 0, error: null, complete: true } };
    const { settings: next, result } = await importSmsHistory(familyId, settings, days);
    return { settings: await saveScanResult(familyId, next), result };
  });
}

function isDuplicate(recent: RecentImport[], candidate: RecentImport) {
  return recent.some(
    (r) =>
      r.type === candidate.type &&
      r.amount === candidate.amount &&
      (r.hint === null || candidate.hint === null || r.hint === candidate.hint) &&
      Math.abs(r.date - candidate.date) <= DUPLICATE_WINDOW_MS
  );
}

/**
 * Payee → category learned from the family's recent history, so once a user files "SWIGGY"
 * under Food, later Swiggy alerts land there too.
 */
async function loadCategoryHints(familyId: string) {
  const map = new Map<string, string>();
  try {
    const res = await api.get<Transaction[]>(`/families/${familyId}/transactions`, { params: { limit: 500 } });
    for (const t of res.data) {
      if (!t.payee || !t.categoryId || t.type === "TRANSFER") continue;
      const key = `${t.type}|${t.payee.trim().toLowerCase()}`;
      // Newest first from the server, so the latest categorisation wins.
      if (!map.has(key)) map.set(key, t.categoryId);
    }
  } catch {
    // Best effort — uncategorised is fine.
  }
  return map;
}

/** State threaded through one scan, message by message. */
interface ScanState {
  settings: SmsImportSettings;
  /** Fingerprints to check duplicates against. */
  recent: RecentImport[];
  imported: number;
  categoryHints: Map<string, string> | null;
}

/** Records `sms` as a transaction if it is a bank alert that hasn't been recorded already. */
async function handleMessage(familyId: string, state: ScanState, sms: InboxSms): Promise<ScanState> {
  const parsed = parseTransactionSms(sms.address, sms.body);
  if (!parsed) return state;

  let { settings, recent, imported, categoryHints } = state;
  if (parsed.accountHint && !settings.seenHints.includes(parsed.accountHint)) {
    settings = { ...settings, seenHints: [parsed.accountHint, ...settings.seenHints].slice(0, MAX_HINTS) };
  }

  const fingerprint: RecentImport = { type: parsed.type, amount: parsed.amount, hint: parsed.accountHint, date: sms.date };
  if (isDuplicate(recent, fingerprint)) return { ...state, settings };

  categoryHints ??= await loadCategoryHints(familyId);
  const accountId = (parsed.accountHint && settings.accountMap[parsed.accountHint]) || settings.defaultAccountId;
  const categoryId = parsed.payee ? categoryHints.get(`${parsed.type}|${parsed.payee.toLowerCase()}`) ?? null : null;

  await api.post(`/families/${familyId}/transactions`, {
    accountId,
    type: parsed.type,
    amount: parsed.amount,
    date: new Date(sms.date).toISOString(),
    categoryId,
    payee: parsed.payee,
    notes: `Recorded from SMS (${sms.address})`,
    tags: ["sms"],
  });

  return {
    settings: { ...settings, totalImported: settings.totalImported + 1 },
    recent: [fingerprint, ...recent].slice(0, MAX_RECENT),
    imported: imported + 1,
    categoryHints,
  };
}

async function precheck(settings: SmsImportSettings): Promise<string | null> {
  if (!(await hasSmsPermission())) return "SMS permission is off. Turn it back on to keep recording transactions.";
  if (!settings.defaultAccountId) return "Choose an account for SMS transactions.";
  return null;
}

/**
 * Reads inbox messages past the watermark, records each bank alert as a transaction, and
 * returns the updated settings. Messages are handled oldest first and the watermark only
 * advances past a message once it has been dealt with, so a network failure mid-way resumes
 * from the failed message next time instead of skipping or double-posting.
 */
export async function syncSmsTransactions(
  familyId: string,
  settings: SmsImportSettings
): Promise<{ settings: SmsImportSettings; result: SmsSyncResult }> {
  let state: ScanState = { settings: { ...settings, lastRunAt: Date.now() }, recent: settings.recent, imported: 0, categoryHints: null };

  const problem = await precheck(state.settings);
  if (problem) return { settings: state.settings, result: { imported: 0, error: problem } };

  let error: string | null = null;
  let scanned = 0;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const messages = await readInbox(state.settings.since, PAGE_SIZE);
      scanned += messages.length;
      for (const sms of messages) {
        state = await handleMessage(familyId, state, sms);
        state = { ...state, settings: { ...state.settings, since: Math.max(state.settings.since, sms.date) } };
      }
      if (messages.length < PAGE_SIZE) break;
    }
  } catch (err) {
    error = getErrorMessage(err, "Couldn't record SMS transactions");
  }

  return { settings: { ...state.settings, recent: state.recent }, result: { imported: state.imported, scanned, error } };
}

/**
 * The optional "import past messages": records bank alerts from the `days` before SMS import was
 * turned on. Walks backwards from `historyFrom`, moving it back message by message, so the handled
 * range stays one unbroken span and a failed or capped run picks up exactly where it stopped —
 * nothing is recorded twice however many times it runs.
 */
export async function importSmsHistory(
  familyId: string,
  settings: SmsImportSettings,
  days: number
): Promise<{ settings: SmsImportSettings; result: SmsHistoryResult }> {
  // Historical fingerprints are only needed to catch double alerts within this run; persisting
  // them would push recent ones out of the forward scan's duplicate check.
  let state: ScanState = { settings, recent: settings.recent, imported: 0, categoryHints: null };
  const start = Date.now() - days * DAY_MS;
  const from = settings.historyFrom ?? settings.since;
  if (start >= from) return { settings, result: { imported: 0, error: null, complete: true } };

  const problem = await precheck(settings);
  if (problem) return { settings, result: { imported: 0, error: problem, complete: false } };

  const finish = (error: string | null, complete: boolean) => ({
    settings: complete ? { ...state.settings, historyFrom: start } : state.settings,
    result: { imported: state.imported, error, complete },
  });

  try {
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const messages = await readInboxBefore(state.settings.historyFrom ?? from, PAGE_SIZE);
      for (const sms of messages) {
        if (sms.date < start) return finish(null, true);
        state = await handleMessage(familyId, state, sms);
        state = { ...state, settings: { ...state.settings, historyFrom: sms.date } };
      }
      // Ran out of inbox before reaching `start`: everything that exists has been handled.
      if (messages.length < PAGE_SIZE) return finish(null, true);
    }
  } catch (err) {
    return finish(getErrorMessage(err, "Couldn't import past SMS"), false);
  }
  return finish(null, false);
}
