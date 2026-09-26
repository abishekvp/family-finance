import type { Budget } from "../api/types";

/** What a budget is called: its own name if it was given one, else its category's. */
export function budgetName(budget: Pick<Budget, "name" | "category">): string {
  return budget.name?.trim() || budget.category.name;
}
