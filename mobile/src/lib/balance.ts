import type { Account, Transaction } from "../api/types";

/**
 * Cumulative balance of the given accounts as of a point in time, given every transaction
 * dated strictly before that point (mirrors the balance formula in GET /accounts, just bounded
 * to "before periodStart" instead of "as of now"). Used for the Settings "carry-over" row.
 */
export function computeCumulativeBalance(
  accounts: Account[],
  priorTransactions: Transaction[],
  accountIds: Set<string>
): number {
  let total = 0;
  for (const account of accounts) {
    if (accountIds.has(account.id)) {
      total += Number(account.openingBalance) || 0;
    }
  }
  for (const t of priorTransactions) {
    if (accountIds.has(t.accountId)) {
      if (t.type === "INCOME") total += t.amount;
      else if (t.type === "EXPENSE") total -= t.amount;
      else if (t.type === "TRANSFER") total -= t.amount;
    }
    if (t.type === "TRANSFER" && t.transferToAccountId && accountIds.has(t.transferToAccountId)) {
      total += t.amount;
    }
  }
  return total;
}
