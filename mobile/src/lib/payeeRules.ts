import { api } from "../api/client";
import type { Category, PayeeRule, Transaction } from "../api/types";
import { decryptedCopy, encryptOutgoing } from "../api/vaultSession";
import { isEncrypted, LOCKED_PLACEHOLDER } from "./vaultCrypto";
import { fetchWithCache } from "./cache";
import { FAMILY_TRANSFER_TAG, isFamilyTransfer } from "./transactionTotals";

/**
 * Payee → category (or "family transfer"). Two sources, in this order:
 *  1. Rules the family saved ("payees starting with SWIGGY are Food", "money from AMMA is a family
 *     transfer"), kept on the server so every member's phone uses them. The payee text is sealed like
 *     a transaction's when the family uses end-to-end encryption, so matching happens on the device.
 *  2. What the family's own history says: where a payee series was filed most often. These are
 *     listed as suggestions the user can keep, change or ignore.
 */

type RuleType = PayeeRule["type"];

export interface CategoryRef {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: Category["type"];
}

/** Where a payee's transactions go. At least one of the two is set. */
export interface PayeeTarget {
  categoryId: string | null;
  category: CategoryRef | null;
  familyTransfer: boolean;
}

/** A mapping read off the family's history rather than saved as a rule. */
export interface LearnedMapping extends PayeeTarget {
  /** The payee series, normalised (see seriesKey). */
  payee: string;
  type: RuleType;
  /** Transactions in this series filed this way. */
  count: number;
  /** How many in the series were filed at all. */
  total: number;
}

export interface CategoryMatch extends PayeeTarget {
  source: "rule" | "learned";
  rule?: PayeeRule;
}

/** Lowercase words of letters and digits only, single-spaced. */
export function normalizePayee(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9À-￿]+/g, " ")
    .trim();
}

/** Payee text that's still sealed (the vault is locked here), so can't be matched. */
export function isSealed(value: string | null | undefined) {
  return value === LOCKED_PLACEHOLDER || isEncrypted(value);
}

/**
 * What a run of payments to the same place have in common: "SWIGGY*4521", "swiggy@ybl" and
 * "Swiggy 0093" are all "swiggy". Drops a UPI handle, digits (order and reference numbers) and
 * punctuation.
 */
export function seriesKey(payee: string) {
  return normalizePayee(payee.replace(/@\S*/g, " ").replace(/[0-9]+/g, " "));
}

/** Whether `pattern` appears in `payee` starting at a word: "swig" matches "Swiggy Bangalore", "ola" doesn't match "Cola". */
export function ruleMatches(pattern: string, payee: string) {
  const p = normalizePayee(pattern);
  if (!p) return false;
  return ` ${normalizePayee(payee)} `.includes(` ${p}`);
}

/** The most specific saved rule for this payee: the longest pattern wins, so "swiggy instamart" beats "swiggy". */
export function findRule(rules: PayeeRule[], payee: string, type: RuleType): PayeeRule | null {
  let best: PayeeRule | null = null;
  for (const rule of rules) {
    if (rule.type !== type || isSealed(rule.payee) || !ruleMatches(rule.payee, payee)) continue;
    if (!best || normalizePayee(rule.payee).length > normalizePayee(best.payee).length) best = rule;
  }
  return best;
}

export function learnedKey(type: RuleType, series: string) {
  return `${type}|${series}`;
}

/** Where a payee goes: a saved rule first, then the family's history. */
export function matchCategory(
  payee: string | null | undefined,
  type: string,
  rules: PayeeRule[],
  learned: Map<string, LearnedMapping>
): CategoryMatch | null {
  if (!payee?.trim() || isSealed(payee) || (type !== "INCOME" && type !== "EXPENSE")) return null;
  const rule = findRule(rules, payee, type);
  if (rule) return { categoryId: rule.categoryId, category: rule.category, familyTransfer: rule.familyTransfer, source: "rule", rule };
  const hit = learned.get(learnedKey(type, seriesKey(payee)));
  return hit ? { categoryId: hit.categoryId, category: hit.category, familyTransfer: hit.familyTransfer, source: "learned" } : null;
}

/** A short description of a target: "Food", "Family transfer", "Family transfer · Gifts". */
export function describeTarget(target: Pick<PayeeTarget, "category" | "familyTransfer">) {
  return [target.familyTransfer ? "Family transfer" : null, target.category?.name ?? null].filter(Boolean).join(" · ");
}

/**
 * Reads payee → target off filed transactions: per payee series, where it was filed most often (the
 * most recent on a tie, given newest-first rows). A family transfer counts as filed even without a
 * category. `categories`, when given, drops archived ones so nothing is filed under a category that's gone.
 */
export function learnMappings(transactions: Transaction[], categories?: Pick<Category, "id">[]): Map<string, LearnedMapping> {
  const live = categories ? new Set(categories.map((c) => c.id)) : null;
  type Entry = PayeeTarget & { count: number };
  const tallies = new Map<string, { type: RuleType; series: string; total: number; byTarget: Map<string, Entry> }>();
  for (const t of transactions) {
    if (t.type === "TRANSFER" || !t.payee || isSealed(t.payee)) continue;
    const familyTransfer = isFamilyTransfer(t);
    const category = t.categoryId && t.category && (!live || live.has(t.categoryId)) ? t.category : null;
    if (!familyTransfer && !category) continue;
    const series = seriesKey(t.payee);
    if (series.length < 2) continue;

    const key = learnedKey(t.type, series);
    let tally = tallies.get(key);
    if (!tally) tallies.set(key, (tally = { type: t.type, series, total: 0, byTarget: new Map() }));
    tally.total++;
    const targetKey = `${familyTransfer ? "family" : ""}|${category?.id ?? ""}`;
    const entry = tally.byTarget.get(targetKey);
    if (entry) entry.count++;
    else tally.byTarget.set(targetKey, { categoryId: category?.id ?? null, category, familyTransfer, count: 1 });
  }

  const out = new Map<string, LearnedMapping>();
  for (const [key, tally] of tallies) {
    let best: Entry | null = null;
    // Map order is first-seen, i.e. newest first, so `>` keeps the most recent on a tie.
    for (const entry of tally.byTarget.values()) if (!best || entry.count > best.count) best = entry;
    if (best) out.set(key, { ...best, payee: tally.series, type: tally.type, total: tally.total });
  }
  return out;
}

// ---- server -------------------------------------------------------------------------------

const rulesUrl = (familyId: string) => `/families/${familyId}/payee-rules`;

function readable(rules: PayeeRule[]) {
  return rules.map((r) => decryptedCopy(r));
}

/**
 * The family's saved rules, payee text decrypted where the vault is open. The copy on disk stays
 * sealed (requests to this URL aren't decrypted by the API client), so `onCached` can show it at once.
 */
export async function fetchPayeeRules(familyId: string, onCached?: (rules: PayeeRule[]) => void): Promise<PayeeRule[]> {
  const res = await fetchWithCache<PayeeRule[]>(rulesUrl(familyId), undefined, onCached ? (cached) => onCached(readable(cached.data)) : undefined);
  return readable(res.data);
}

export interface PayeeRuleInput {
  payee: string;
  type: RuleType;
  categoryId: string | null;
  familyTransfer: boolean;
}

export async function createPayeeRule(familyId: string, input: PayeeRuleInput): Promise<PayeeRule> {
  const body = encryptOutgoing(familyId, { ...input, payee: input.payee.trim() });
  const res = await api.post<PayeeRule>(rulesUrl(familyId), body);
  return decryptedCopy(res.data);
}

export async function updatePayeeRule(familyId: string, id: string, input: Partial<PayeeRuleInput>): Promise<PayeeRule> {
  const body = encryptOutgoing(familyId, input.payee === undefined ? input : { ...input, payee: input.payee.trim() });
  const res = await api.patch<PayeeRule>(`${rulesUrl(familyId)}/${id}`, body);
  return decryptedCopy(res.data);
}

export async function deletePayeeRule(familyId: string, id: string): Promise<void> {
  await api.delete(`${rulesUrl(familyId)}/${id}`);
}

// ---- applying -----------------------------------------------------------------------------

/**
 * Expenses and income nobody has filed yet — what the end-of-day reminder counts and rules can fill
 * in. A family transfer needs no category, and lend & borrow entries' category is optional.
 */
export function isUncategorized(t: Transaction) {
  return t.type !== "TRANSFER" && !t.categoryId && !isFamilyTransfer(t) && !t.tags.some((tag) => tag.startsWith("lending:"));
}

/** The tags a transaction should carry once a match is applied. */
export function tagsWithTarget(tags: string[], familyTransfer: boolean) {
  const rest = tags.filter((tag) => tag !== FAMILY_TRANSFER_TAG);
  return familyTransfer ? [...rest, FAMILY_TRANSFER_TAG] : rest;
}

/** The fields to save on a transaction for this match. */
export function matchPatch(t: Pick<Transaction, "tags" | "categoryId">, match: PayeeTarget): { categoryId?: string; tags?: string[] } {
  const patch: { categoryId?: string; tags?: string[] } = {};
  if (match.categoryId && match.categoryId !== t.categoryId) patch.categoryId = match.categoryId;
  if (match.familyTransfer && !t.tags.includes(FAMILY_TRANSFER_TAG)) patch.tags = tagsWithTarget(t.tags, true);
  return patch;
}

/** Unfiled transactions a rule (or the history) has an answer for. */
export function categorizable(transactions: Transaction[], rules: PayeeRule[], learned: Map<string, LearnedMapping>, { rulesOnly = false } = {}) {
  const out: { transaction: Transaction; match: CategoryMatch }[] = [];
  for (const t of transactions) {
    if (!isUncategorized(t)) continue;
    const match = matchCategory(t.payee, t.type, rules, rulesOnly ? new Map() : learned);
    if (match) out.push({ transaction: t, match });
  }
  return out;
}

/** Files each transaction as its match says, one at a time; returns how many were saved. */
export async function applyMatches(familyId: string, items: { transaction: Transaction; match: PayeeTarget }[]) {
  let saved = 0;
  for (const { transaction, match } of items) {
    const patch = matchPatch(transaction, match);
    if (Object.keys(patch).length === 0) continue;
    await api.patch(`/families/${familyId}/transactions/${transaction.id}`, patch);
    saved++;
  }
  return saved;
}
