import type { Transaction } from "../api/types";

/** Marks an income or expense as money to or from family (see countedAmount). */
export const FAMILY_TRANSFER_TAG = "family-transfer";

export function isFamilyTransfer(t: Pick<Transaction, "type" | "tags">) {
  return t.type !== "TRANSFER" && (t.tags ?? []).includes(FAMILY_TRANSFER_TAG);
}

/**
 * What an entry counts for in income and spending totals. Shared by every screen that adds things
 * up (and mirrored in the mobile app's src/lib/transactionTotals.ts) so the same period always shows
 * the same numbers everywhere.
 *
 * - Transfers move money between your own accounts: never income or spending.
 * - A refund or return (`refundsId` set) never counts on its own; it takes its amount off the entry
 *   it reverses instead (see the server's resolveRefunds). A fully refunded charge counts as nothing;
 *   a partly refunded one counts for what wasn't refunded.
 *
 * - A family transfer (tagged FAMILY_TRANSFER_TAG) — money from a parent, or sent home — is
 *   neither income nor spending, and unlike lend & borrow nobody owes it back.
 *
 * Account balances aren't adjusted this way: both legs really moved money.
 */
export function countedAmount(t: Transaction): number {
  if (t.type === "TRANSFER" || t.refundsId || isFamilyTransfer(t)) return 0;
  const refunded = t.refundedAmount ?? (t.isRefunded ? t.amount : 0);
  return Math.max(0, t.amount - refunded);
}

export function countsTowardTotals(t: Transaction): boolean {
  return countedAmount(t) > 0;
}

export function totalsContribution(t: Transaction): { income: number; expense: number } {
  const amount = countedAmount(t);
  if (t.type === "INCOME") return { income: amount, expense: 0 };
  if (t.type === "EXPENSE") return { income: 0, expense: amount };
  return { income: 0, expense: 0 };
}
