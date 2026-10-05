import type { Transaction } from "../api/types";
import type { CashflowPoint } from "../components/charts";
import { countedAmount } from "./transactionTotals";

export interface Bucket {
  from: Date;
  to: Date;
  /** Axis label ("Mar"). */
  label: string;
  /** Tooltip label ("March 2026"). */
  full: string;
}

/** `count` calendar months ending with the month of `end`, oldest first. */
export function monthBuckets(end: Date, count: number): Bucket[] {
  const out: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const from = new Date(end.getFullYear(), end.getMonth() - i, 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    out.push({
      from,
      to,
      label: from.toLocaleDateString(undefined, { month: "short" }),
      full: from.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    });
  }
  return out;
}

/** The bucket a date falls in, or -1. Buckets are sorted and contiguous. */
function bucketIndex(buckets: Bucket[], at: Date) {
  if (buckets.length === 0 || at < buckets[0].from || at >= buckets[buckets.length - 1].to) return -1;
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (at < buckets[mid].from) hi = mid - 1;
    else if (at >= buckets[mid].to) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Income, spending and net per bucket, after refunds and family transfers (see countedAmount). */
export function cashflow(transactions: Transaction[], accountIds: Set<string>, buckets: Bucket[]): CashflowPoint[] {
  const points = buckets.map((b) => ({ label: b.label, full: b.full, income: 0, expense: 0, net: 0 }));
  for (const t of transactions) {
    if (!accountIds.has(t.accountId) || (t.type !== "INCOME" && t.type !== "EXPENSE")) continue;
    const i = bucketIndex(buckets, new Date(t.date));
    if (i < 0) continue;
    const amount = countedAmount(t);
    if (t.type === "INCOME") points[i].income += amount;
    else points[i].expense += amount;
  }
  for (const p of points) p.net = p.income - p.expense;
  return points;
}

export interface CategoryTotal {
  key: string;
  name: string;
  color: string;
  amount: number;
  count: number;
}

const UNCATEGORIZED_COLOR = "#94A3B8";

/** What each category came to, biggest first. */
export function categoryTotals(transactions: Transaction[], accountIds: Set<string>, type: "INCOME" | "EXPENSE"): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const t of transactions) {
    if (t.type !== type || !accountIds.has(t.accountId)) continue;
    const amount = countedAmount(t);
    if (amount <= 0) continue;
    const key = t.categoryId ?? "uncategorized";
    const entry = map.get(key) ?? { key, name: t.category?.name ?? "Uncategorized", color: t.category?.color ?? UNCATEGORIZED_COLOR, amount: 0, count: 0 };
    entry.amount += amount;
    entry.count += 1;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

/** Per bucket, the top `limit` categories (by total over all buckets) and everything else as "Other". */
export function categoryTrend(transactions: Transaction[], accountIds: Set<string>, type: "INCOME" | "EXPENSE", buckets: Bucket[], limit = 5) {
  const inRange = transactions.filter((t) => bucketIndex(buckets, new Date(t.date)) >= 0);
  const top = categoryTotals(inRange, accountIds, type).slice(0, limit);
  const topKeys = new Set(top.map((c) => c.key));
  const rows: Record<string, number | string>[] = buckets.map((b) => ({ label: b.label, full: b.full }));
  let hasOther = false;
  for (const t of inRange) {
    if (t.type !== type || !accountIds.has(t.accountId)) continue;
    const amount = countedAmount(t);
    if (amount <= 0) continue;
    const i = bucketIndex(buckets, new Date(t.date));
    const key = topKeys.has(t.categoryId ?? "uncategorized") ? t.categoryId ?? "uncategorized" : "other";
    if (key === "other") hasOther = true;
    rows[i][key] = (Number(rows[i][key]) || 0) + amount;
  }
  const series = [
    ...top.map((c) => ({ key: c.key, label: c.name, color: c.color })),
    ...(hasOther ? [{ key: "other", label: "Other", color: UNCATEGORIZED_COLOR }] : []),
  ];
  return { rows, series };
}
