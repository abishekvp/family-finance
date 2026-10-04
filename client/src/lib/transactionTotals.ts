import type { Transaction } from "../api/types";

/**
 * False for a refunded expense or the income entry that refunds it — together they cancel out, so
 * the payment counts as never having happened for spending/income totals (see server's resolveRefunds).
 * Account balances aren't filtered this way: both legs really moved money.
 */
export function countsTowardTotals(t: Transaction): boolean {
  if (t.type === "EXPENSE" && t.isRefunded) return false;
  if (t.type === "INCOME" && t.refundsId) return false;
  
  const catName = t.category?.name?.toLowerCase() || "";
  if (catName.includes("return") || catName.includes("refund")) return false;

  return true;
}

export function totalsContribution(t: Transaction): { income: number; expense: number } {
  if (!countsTowardTotals(t)) return { income: 0, expense: 0 };
  if (t.type === "INCOME") return { income: t.amount, expense: 0 };
  if (t.type === "EXPENSE") return { income: 0, expense: t.amount };
  return { income: 0, expense: 0 };
}
