import type { Transaction } from "../api/types";

/** Marks an income or expense as money to or from family (see countedAmount). */
export const FAMILY_TRANSFER_TAG = "family-transfer";

/** Marks an income or expense that moves a balance but never counts as income or spending (see countedAmount). */
export const NOT_COUNTED_TAG = "not-counted";

export function isFamilyTransfer(t: Pick<Transaction, "type" | "tags">) {
  return t.type !== "TRANSFER" && (t.tags ?? []).includes(FAMILY_TRANSFER_TAG);
}

export function isNotCounted(t: Pick<Transaction, "type" | "tags">) {
  return t.type !== "TRANSFER" && (t.tags ?? []).includes(NOT_COUNTED_TAG);
}

/**
 * What an entry counts for in income and spending totals. Shared by every screen that adds things
 * up (and mirrored in the web app's lib/transactionTotals.ts) so the same period always shows the
 * same numbers everywhere.
 *
 * - Transfers move money between your own accounts, and lend & borrow moves it to and from people:
 *   never income or spending.
 * - A refund or return (`refundsId` set) never counts on its own; it takes its amount off the entry
 *   it reverses instead. So a ₹2 card-verification charge refunded straight away counts as nothing,
 *   and a ₹1,000 order with ₹300 refunded counts as ₹700 of spending.
 * - A family transfer (tagged FAMILY_TRANSFER_TAG) — money from a parent, or sent home — is
 *   neither income nor spending, and unlike lend & borrow nobody owes it back.
 * - Anything tagged NOT_COUNTED_TAG, e.g. money lent that won't come back, written off without
 *   counting it as spending.
 *
 * Account balances aren't adjusted this way: both legs really moved money.
 */
export function countedAmount(t: Transaction): number {
  if (t.type === "TRANSFER" || t.refundsId || isFamilyTransfer(t) || isNotCounted(t)) return 0;
  // Rows synced before the server sent refundedAmount only know whether they were refunded.
  const refunded = t.refundedAmount ?? (t.isRefunded ? t.amount : 0);
  return Math.max(0, t.amount - refunded);
}

export function totalsContribution(t: Transaction): { income: number; expense: number } {
  const amount = countedAmount(t);
  if (t.type === "INCOME") return { income: amount, expense: 0 };
  if (t.type === "EXPENSE") return { income: 0, expense: amount };
  return { income: 0, expense: 0 };
}

/** Income and spending of `transactions`, after refunds. */
export function sumTotals(transactions: Iterable<Transaction>): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    const c = totalsContribution(t);
    income += c.income;
    expense += c.expense;
  }
  return { income, expense };
}
