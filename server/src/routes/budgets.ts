import { Router } from "express";
import { z } from "zod";
import { BudgetPeriod, CategoryType, Prisma, RecurringFrequency, Role, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { occurrencesBetween } from "../lib/recurring";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";

export const budgetsRouter = Router({ mergeParams: true });
budgetsRouter.use(requireAuth);

const BUDGET_CATEGORY_SELECT = {
  id: true,
  name: true,
  color: true,
  icon: true,
  type: true,
} satisfies Prisma.CategorySelect;

function isVisible(ownerId: string | null, requesterId: string) {
  return ownerId === null || ownerId === requesterId;
}

function assertCanModify(ownerId: string | null, requesterId: string, role: Role) {
  if (ownerId === null) {
    if (role !== Role.ADMIN) {
      throw new AppError(403, "Only an admin can modify a shared budget");
    }
  } else if (ownerId !== requesterId) {
    throw new AppError(403, "Not allowed to modify this budget");
  }
}

// Resolves the [start, end) window a budget's "spent" total is computed over:
// MONTHLY periods run for the calendar month, ANNUAL periods for the calendar year.
function periodRange(period: BudgetPeriod, year: number, month: number | null) {
  if (period === BudgetPeriod.ANNUAL) {
    return {
      start: new Date(Date.UTC(year, 0, 1)),
      end: new Date(Date.UTC(year + 1, 0, 1)),
    };
  }
  const m = month ?? 1;
  return {
    start: new Date(Date.UTC(year, m - 1, 1)),
    end: new Date(Date.UTC(year, m, 1)),
  };
}

// A yearly repeating payment (an annual subscription) belongs to the yearly budget, so it doesn't
// eat a single month's budget in the month it happens to fall.
function countsInPeriod(period: BudgetPeriod, frequency: RecurringFrequency) {
  return period === BudgetPeriod.ANNUAL || frequency !== RecurringFrequency.YEARLY;
}

async function computeSpent(familyId: string, requesterId: string, categoryId: string, period: BudgetPeriod, start: Date, end: Date) {
  const spentAgg = await prisma.transaction.aggregate({
    where: {
      familyId,
      categoryId,
      type: TransactionType.EXPENSE,
      isDeleted: false,
      date: { gte: start, lt: end },
      account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
      ...(period === BudgetPeriod.ANNUAL
        ? {}
        : { OR: [{ recurringId: null }, { recurring: { frequency: { not: RecurringFrequency.YEARLY } } }] }),
    },
    _sum: { amount: true },
  });
  return Number(spentAgg._sum.amount ?? 0);
}

type ExpenseRule = Prisma.RecurringTransactionGetPayload<object>;

/** Repeating expenses in this category still to come in the period: committed, not yet spent. */
function computeUpcoming(rules: ExpenseRule[], categoryId: string, period: BudgetPeriod, start: Date, end: Date) {
  let total = 0;
  for (const rule of rules) {
    if (rule.categoryId !== categoryId || !countsInPeriod(period, rule.frequency)) continue;
    total += occurrencesBetween(rule, rule.postedCount, start, end).length * Number(rule.amount);
  }
  return total;
}

const budgetKey = (b: { categoryId: string; ownerId: string | null }) => `${b.categoryId}|${b.ownerId ?? ""}`;

type BudgetWithCategory = Prisma.BudgetGetPayload<{ include: { category: { select: typeof BUDGET_CATEGORY_SELECT } } }>;
type ProjectedBudget = BudgetWithCategory & { projected: true; sourceId: string };

/**
 * Carries repeating budgets into the requested month (or year): the latest earlier budget for each
 * category decides. If it repeats and this period has none yet, a copy is created once the period
 * has started, or (for a future period, when asked) returned as a projection that isn't saved.
 */
async function carryRepeating(
  familyId: string,
  requesterId: string,
  period: BudgetPeriod,
  year: number,
  month: number | null,
  includeProjected: boolean
): Promise<ProjectedBudget[]> {
  const now = new Date();
  const started =
    period === BudgetPeriod.ANNUAL
      ? year <= now.getUTCFullYear()
      : year * 12 + (month! - 1) <= now.getUTCFullYear() * 12 + now.getUTCMonth();
  const before: Prisma.BudgetWhereInput =
    period === BudgetPeriod.ANNUAL ? { year: { lt: year } } : { OR: [{ year: { lt: year } }, { year, month: { lt: month! } }] };

  const [earlier, present] = await Promise.all([
    prisma.budget.findMany({
      where: { familyId, period, category: { isArchived: false }, AND: [{ OR: [{ ownerId: null }, { ownerId: requesterId }] }, before] },
      include: { category: { select: BUDGET_CATEGORY_SELECT } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),
    prisma.budget.findMany({ where: { familyId, period, year, month }, select: { categoryId: true, ownerId: true } }),
  ]);

  const latest = new Map<string, BudgetWithCategory>();
  for (const b of earlier) if (!latest.has(budgetKey(b))) latest.set(budgetKey(b), b);
  const presentKeys = new Set(present.map(budgetKey));

  const projected: ProjectedBudget[] = [];
  for (const source of latest.values()) {
    if (!source.repeats || presentKeys.has(budgetKey(source))) continue;
    if (started) {
      try {
        await prisma.budget.create({
          data: {
            // Deterministic, so two devices opening the new month at once create it only once.
            id: `${source.id}-${year}${month ? `-${String(month).padStart(2, "0")}` : ""}`,
            familyId,
            ownerId: source.ownerId,
            categoryId: source.categoryId,
            period,
            amount: source.amount,
            year,
            month,
            rollover: source.rollover,
            repeats: true,
          },
        });
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
    } else if (includeProjected) {
      projected.push({ ...source, id: `projected-${source.id}`, year, month, projected: true, sourceId: source.id });
    }
  }
  return projected;
}

budgetsRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    let year: number | undefined;
    if (typeof req.query.year === "string") {
      year = Number(req.query.year);
      if (!Number.isInteger(year)) throw new AppError(400, "Invalid year filter");
    }
    let month: number | undefined;
    if (typeof req.query.month === "string") {
      month = Number(req.query.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) {
        throw new AppError(400, "Invalid month filter");
      }
    }
    let period: BudgetPeriod | undefined;
    if (typeof req.query.period === "string") {
      const parsed = z.nativeEnum(BudgetPeriod).safeParse(req.query.period);
      if (!parsed.success) throw new AppError(400, "Invalid period filter");
      period = parsed.data;
    }
    // Future periods can show repeating budgets that will be added when the period starts. Only
    // clients that know those are read-only ask for them.
    const includeProjected = req.query.includeProjected === "1";

    let projected: ProjectedBudget[] = [];
    if (year !== undefined && month !== undefined) {
      projected = await carryRepeating(familyId, requesterId, BudgetPeriod.MONTHLY, year, month, includeProjected);
    } else if (year !== undefined && period === BudgetPeriod.ANNUAL) {
      projected = await carryRepeating(familyId, requesterId, BudgetPeriod.ANNUAL, year, null, includeProjected);
    }

    const [budgets, expenseRules] = await Promise.all([
      prisma.budget.findMany({
        where: {
          familyId,
          OR: [{ ownerId: null }, { ownerId: requesterId }],
          ...(year !== undefined ? { year } : {}),
          ...(month !== undefined ? { month } : {}),
          ...(period !== undefined ? { period } : {}),
        },
        include: { category: { select: BUDGET_CATEGORY_SELECT } },
        orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "asc" }],
      }),
      prisma.recurringTransaction.findMany({
        where: {
          familyId,
          type: TransactionType.EXPENSE,
          isActive: true,
          categoryId: { not: null },
          account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
        },
      }),
    ]);

    const withSpent = await Promise.all(
      [...budgets, ...projected].map(async (budget) => {
        const { start, end } = periodRange(budget.period, budget.year, budget.month);
        const spent = await computeSpent(familyId, requesterId, budget.categoryId, budget.period, start, end);
        const upcoming = computeUpcoming(expenseRules, budget.categoryId, budget.period, start, end);
        const amount = Number(budget.amount);
        return { ...budget, amount, spent, upcoming, remaining: amount - spent };
      })
    );

    res.json(withSpent);
  })
);

const createBudgetSchema = z
  .object({
    categoryId: z.string().min(1),
    amount: z.number().finite().gt(0),
    year: z.number().int(),
    month: z.number().int().min(1).max(12).optional(),
    period: z.nativeEnum(BudgetPeriod).default(BudgetPeriod.MONTHLY),
    rollover: z.boolean().default(false),
    repeats: z.boolean().default(false),
    isCommon: z.boolean().default(true),
  })
  .refine((data) => data.period === BudgetPeriod.ANNUAL || data.month !== undefined, {
    message: "month is required unless period is ANNUAL",
    path: ["month"],
  });

budgetsRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const data = createBudgetSchema.parse(req.body);

    const category = await prisma.category.findFirst({
      where: { id: data.categoryId, familyId, isArchived: false },
    });
    if (!category) throw new AppError(404, "Category not found");
    if (!isVisible(category.ownerId, requesterId)) {
      throw new AppError(403, "Cannot budget against another member's private category");
    }
    if (category.type !== CategoryType.EXPENSE) {
      throw new AppError(400, "Budgets can only be set on expense categories");
    }

    try {
      const budget = await prisma.budget.create({
        data: {
          familyId,
          ownerId: data.isCommon ? null : requesterId,
          categoryId: data.categoryId,
          amount: data.amount,
          period: data.period,
          year: data.year,
          month: data.period === BudgetPeriod.ANNUAL ? null : data.month ?? null,
          rollover: data.rollover,
          repeats: data.repeats,
        },
        include: { category: { select: BUDGET_CATEGORY_SELECT } },
      });

      res.status(201).json({ ...budget, amount: Number(budget.amount), spent: 0, upcoming: 0, remaining: Number(budget.amount) });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "A budget already exists for this category and period — edit it instead.");
      }
      throw err;
    }
  })
);

const updateBudgetSchema = z.object({
  amount: z.number().finite().gt(0).optional(),
  rollover: z.boolean().optional(),
  repeats: z.boolean().optional(),
});

budgetsRouter.patch(
  "/:budgetId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.budget.findFirst({
      where: { id: req.params.budgetId, familyId },
    });
    if (!existing) throw new AppError(404, "Budget not found");

    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    const data = updateBudgetSchema.parse(req.body);

    const updated = await prisma.budget.update({
      where: { id: existing.id },
      data: {
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.rollover !== undefined ? { rollover: data.rollover } : {}),
        ...(data.repeats !== undefined ? { repeats: data.repeats } : {}),
      },
      include: { category: { select: BUDGET_CATEGORY_SELECT } },
    });

    res.json({ ...updated, amount: Number(updated.amount) });
  })
);

budgetsRouter.delete(
  "/:budgetId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.budget.findFirst({
      where: { id: req.params.budgetId, familyId },
    });
    if (!existing) throw new AppError(404, "Budget not found");

    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    await prisma.budget.delete({ where: { id: existing.id } });

    res.status(204).send();
  })
);
