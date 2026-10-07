import type { Transaction } from "../api/types";

/**
 * The balance `accountIds` held just before `boundary`, for the "Carried over" row shown when a
 * viewed period has no transactions: what each account held when the year began (`startBalances`,
 * from GET /accounts/balances?asOf=<1 January>) plus that year's transactions dated before the
 * boundary — INCOME adds, EXPENSE and the outgoing leg of a TRANSFER subtract, the incoming leg adds,
 * mirroring the server's balance formula.
 *
 * `yearTransactions` covers the year from 1 January, so a boundary before then (the first week of
 * January can start in December) reads as the start of the year.
 */
export function cumulativeBalance(
  startBalances: Record<string, number> | undefined,
  yearTransactions: Transaction[],
  accountIds: Set<string>,
  boundary: Date
): number {
  let total = 0;
  for (const id of accountIds) total += startBalances?.[id] ?? 0;
  const before = boundary.getTime();
  for (const t of yearTransactions) {
    if (new Date(t.date).getTime() >= before) continue;
    const amount = Number(t.amount);
    if (accountIds.has(t.accountId)) total += t.type === "INCOME" ? amount : -amount;
    if (t.type === "TRANSFER" && t.transferToAccountId && accountIds.has(t.transferToAccountId)) total += amount;
  }
  return total;
}
