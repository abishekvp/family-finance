import crypto from "crypto";
import { CategoryType } from "@prisma/client";

export const DEFAULT_CATEGORIES: Array<{
  name: string;
  type: CategoryType;
  color: string;
  icon: string;
  children: string[];
}> = [
  { name: "Housing", type: "EXPENSE", color: "#F97316", icon: "home", children: ["Rent/Mortgage", "Utilities", "Internet"] },
  { name: "Groceries", type: "EXPENSE", color: "#22C55E", icon: "shopping-cart", children: [] },
  { name: "Transport", type: "EXPENSE", color: "#3B82F6", icon: "car", children: ["Fuel", "Public Transit"] },
  { name: "Dining Out", type: "EXPENSE", color: "#EF4444", icon: "utensils", children: [] },
  { name: "Entertainment", type: "EXPENSE", color: "#A855F7", icon: "film", children: [] },
  { name: "Health", type: "EXPENSE", color: "#14B8A6", icon: "heart-pulse", children: ["Medicine", "Insurance"] },
  { name: "Shopping", type: "EXPENSE", color: "#EC4899", icon: "shopping-bag", children: [] },
  { name: "Other Expense", type: "EXPENSE", color: "#64748B", icon: "more-horizontal", children: [] },
  { name: "Salary", type: "INCOME", color: "#0EA5E9", icon: "briefcase", children: [] },
  { name: "Bonus", type: "INCOME", color: "#10B981", icon: "gift", children: [] },
  { name: "Other Income", type: "INCOME", color: "#84CC16", icon: "plus-circle", children: [] },
];

export async function seedDefaultCategories(
  tx: import("@prisma/client").Prisma.TransactionClient,
  familyId: string
) {
  // Built as a single batched insert (rather than one create() per row) because pooled/serverless
  // Postgres connections (e.g. Prisma Accelerate) can drop long-running interactive transactions
  // before a couple dozen sequential round-trips finish, surfacing as P2028 "Transaction not found".
  const rows: {
    id: string;
    familyId: string;
    parentId: string | null;
    name: string;
    type: CategoryType;
    color: string;
    icon: string;
    sortOrder: number;
  }[] = [];

  let sortOrder = 0;
  for (const cat of DEFAULT_CATEGORIES) {
    const parentId = crypto.randomUUID();
    rows.push({
      id: parentId,
      familyId,
      parentId: null,
      name: cat.name,
      type: cat.type,
      color: cat.color,
      icon: cat.icon,
      sortOrder: sortOrder++,
    });
    let childSort = 0;
    for (const childName of cat.children) {
      rows.push({
        id: crypto.randomUUID(),
        familyId,
        parentId,
        name: childName,
        type: cat.type,
        color: cat.color,
        icon: cat.icon,
        sortOrder: childSort++,
      });
    }
  }

  await tx.category.createMany({ data: rows });
}
