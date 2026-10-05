import type { Transaction } from "../api/types";

/**
 * What an entry counts for in income and spending totals. Shared by every screen that adds things
 * up (and mirrored in the web app's lib/transactionTotals.ts) so the same period always shows the
 * same numbers everywhere.
 *
 * - Transfers move money between your own accounts: never income or spending.
 * - A refund or return (`refundsId` set) never counts on its own; it takes its amount off the entry
 *   it reverses instead. So a ₹2 card-verification charge refunded straight away counts as nothing,
 *   and a ₹1,000 order with ₹300 refunded counts as ₹700 of spending.
 *
 * Account balances aren't adjusted this way: both legs really moved money.
 */
export function countedAmount(t: Transaction): number {
  if (t.type === "TRANSFER" || t.refundsId) return 0;
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
