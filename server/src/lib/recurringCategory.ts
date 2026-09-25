import { BudgetPeriod, RecurringFrequency } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * A category and its subcategories: a budget on "Housing" also covers "Rent" and "Utilities".
 * Archived subcategories are kept so their past transactions still count.
 */
export async function categoryWithChildren(familyId: string, categoryId: string): Promise<string[]> {
  const children = await prisma.category.findMany({ where: { familyId, parentId: categoryId }, select: { id: true } });
  return [categoryId, ...children.map((c) => c.id)];
}

/** Start of the budget period a repeating payment's occurrences count in, as of now (UTC). */
export function currentPeriodStart(frequency: RecurringFrequency, now = new Date()): Date {
  return frequency === RecurringFrequency.YEARLY
    ? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Start of a budget's period. */
export function budgetPeriodStart(period: BudgetPeriod, year: number, month: number | null): Date {
  return period === BudgetPeriod.ANNUAL ? new Date(Date.UTC(year, 0, 1)) : new Date(Date.UTC(year, (month ?? 1) - 1, 1));
}

/**
 * Moves a repeating payment to another category (or none), along with the occurrences it already
 * recorded from `since` on, so the budget it now counts in shows this period's payments too. An
 * occurrence that was given its own category by hand keeps it.
 */
export async function moveRuleCategory(
  rule: { id: string; categoryId: string | null },
  categoryId: string | null,
  since: Date
) {
  if (rule.categoryId === categoryId) return;
  await prisma.$transaction([
    prisma.recurringTransaction.update({ where: { id: rule.id }, data: { categoryId } }),
    prisma.transaction.updateMany({
      where: { recurringId: rule.id, isDeleted: false, date: { gte: since }, categoryId: rule.categoryId },
      data: { categoryId },
    }),
  ]);
}
