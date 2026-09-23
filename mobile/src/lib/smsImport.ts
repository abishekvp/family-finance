import * as SecureStore from "expo-secure-store";
import { api } from "../api/client";
import type { Transaction } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { hasSmsPermission, readInbox } from "../../modules/sms-reader";
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
  /** Watermark: only messages received after this (epoch millis) are read. */
  since: number;
  recent: RecentImport[];
  lastRunAt: number | null;
  totalImported: number;
}

export interface SmsSyncResult {
  imported: number;
  error: string | null;
}

// SecureStore keys may only contain [A-Za-z0-9._-].
const SETTINGS_KEY = "familyFinance.smsImport";
const MAX_RECENT = 60;
const MAX_HINTS = 12;
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
// The bank and the UPI app often both alert for one payment, minutes apart.
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export const DEFAULT_SMS_SETTINGS: SmsImportSettings = {
  enabled: false,
  familyId: null,
  defaultAccountId: null,
  accountMap: {},
  seenHints: [],
  since: 0,
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
        return { ...DEFAULT_SMS_SETTINGS, ...parsed };
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
  let next: SmsImportSettings = { ...settings, lastRunAt: Date.now() };

  if (!(await hasSmsPermission())) {
    return { settings: next, result: { imported: 0, error: "SMS permission is off. Turn it back on to keep recording transactions." } };
  }
  if (!next.defaultAccountId) {
    return { settings: next, result: { imported: 0, error: "Choose an account for SMS transactions." } };
  }

  let imported = 0;
  let categoryHints: Map<string, string> | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const messages = await readInbox(next.since, PAGE_SIZE);

      for (const sms of messages) {
        const parsed = parseTransactionSms(sms.address, sms.body);
        if (parsed) {
          if (parsed.accountHint && !next.seenHints.includes(parsed.accountHint)) {
            next = { ...next, seenHints: [parsed.accountHint, ...next.seenHints].slice(0, MAX_HINTS) };
          }

          const fingerprint: RecentImport = { type: parsed.type, amount: parsed.amount, hint: parsed.accountHint, date: sms.date };
          if (!isDuplicate(next.recent, fingerprint)) {
            categoryHints ??= await loadCategoryHints(familyId);
            const accountId = (parsed.accountHint && next.accountMap[parsed.accountHint]) || next.defaultAccountId;
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

            imported += 1;
            next = {
              ...next,
              recent: [fingerprint, ...next.recent].slice(0, MAX_RECENT),
              totalImported: next.totalImported + 1,
            };
          }
        }
        next = { ...next, since: Math.max(next.since, sms.date) };
      }

      if (messages.length < PAGE_SIZE) break;
    }
  } catch (err) {
    return { settings: next, result: { imported, error: getErrorMessage(err, "Couldn't record SMS transactions") } };
  }

  return { settings: next, result: { imported, error: null } };
}
