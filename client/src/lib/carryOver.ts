import type { Account, Transaction } from "../api/types";

/**
 * Sums opening balances plus every transaction dated strictly before `boundary` for the given
 * accounts, mirroring the server's per-account balance formula (INCOME adds, EXPENSE and the
 * outgoing leg of a TRANSFER subtract, the incoming leg of a TRANSFER adds to the destination).
 * Used to render a "Carry-over" row when a viewed period has zero transactions.
 */
export function cumulativeBalance(
  accounts: Account[],
  priorTransactions: Transaction[],
  accountIds: Set<string>,
  boundary: Date
): number {
  let total = 0;
  for (const account of accounts) {
    if (accountIds.has(account.id)) total += Number(account.openingBalance);
  }
  for (const t of priorTransactions) {
    if (new Date(t.date) >= boundary) continue;
    const amount = Number(t.amount);
    if (accountIds.has(t.accountId)) {
      total += t.type === "INCOME" ? amount : -amount;
    }
    if (t.type === "TRANSFER" && t.transferToAccountId && accountIds.has(t.transferToAccountId)) {
      total += amount;
    }
  }
  return total;
}
