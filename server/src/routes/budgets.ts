import { Router, type Request } from "express";
import { z } from "zod";
import { BudgetPeriod, CategoryType, Prisma, RecurringFrequency, Role, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { occurrencesBetween } from "../lib/recurring";
import { budgetPeriodStart, categoryWithChildren, moveRuleCategory } from "../lib/recurringCategory";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { COUNTED } from "../lib/approval";

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

// Resolves the [start, end) window a budget's "spent" total is computed over.
// Monthly boundaries use the client's local timezone (via tzOffset in minutes).
function periodRange(period: BudgetPeriod, year: number, month: number | null, tzOffset: number = 0) {
  const offsetMs = tzOffset * 60000;
  if (period === BudgetPeriod.ANNUAL) {
    return {
      start: new Date(Date.UTC(year, 0, 1) + offsetMs),
      end: new Date(Date.UTC(year + 1, 0, 1) + offsetMs),
    };
  }
  const m = month ?? 1;
  return {
    start: new Date(Date.UTC(year, m - 1, 1) + offsetMs),
    end: new Date(Date.UTC(year, m, 1) + offsetMs),
  };
}

// A yearly repeating payment (an annual subscription) belongs to the yearly budget, so it doesn't
// eat a single month's budget in the month it happens to fall.
function countsInPeriod(period: BudgetPeriod, frequency: RecurringFrequency) {
  return period === BudgetPeriod.ANNUAL || frequency !== RecurringFrequency.YEARLY;
}

async function computeSpent(familyId: string, requesterId: string, categoryIds: string[], period: BudgetPeriod, start: Date, end: Date) {
  const spentAgg = await prisma.transaction.aggregate({
    where: {
      familyId,
      categoryId: { in: categoryIds },
      type: TransactionType.EXPENSE,
      isDeleted: false,
      ...COUNTED,
      // A refunded expense counts as never spent — the entry that reverses it is kept out of income
      // totals the same way (see resolveRefunds in routes/transactions.ts).
      refundedBy: { none: { isDeleted: false, ...COUNTED } },
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

/** The repeating expenses that count in a budget: in its category (or a subcategory) and its period. */
function rulesInBudget(rules: ExpenseRule[], categoryIds: string[], period: BudgetPeriod) {
  return rules.filter((rule) => rule.categoryId !== null && categoryIds.includes(rule.categoryId) && countsInPeriod(period, rule.frequency));
}

/** Repeating expenses in this budget still to come in the period: committed, not yet spent. */
function computeUpcoming(rules: ExpenseRule[], period: BudgetPeriod, start: Date, end: Date) {
  let total = 0;
  for (const rule of rules) {
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
            name: source.name,
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
    let tzOffset = 0;
    if (typeof req.query.tzOffset === "string") {
      const parsed = Number(req.query.tzOffset);
      if (Number.isFinite(parsed)) tzOffset = parsed;
    }

    let projected: ProjectedBudget[] = [];
    if (year !== undefined && month !== undefined) {
      projected = await carryRepeating(familyId, requesterId, BudgetPeriod.MONTHLY, year, month, includeProjected);
    } else if (year !== undefined && period === BudgetPeriod.ANNUAL) {
      projected = await carryRepeating(familyId, requesterId, BudgetPeriod.ANNUAL, year, null, includeProjected);
    }

    const [budgets, expenseRules, subcategories] = await Promise.all([
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
      prisma.category.findMany({ where: { familyId, parentId: { not: null } }, select: { id: true, parentId: true } }),
    ]);

    const withSpent = await Promise.all(
      [...budgets, ...projected].map(async (budget) => {
        const { start, end } = periodRange(budget.period, budget.year, budget.month, tzOffset);
        const categoryIds = [budget.categoryId, ...subcategories.filter((c) => c.parentId === budget.categoryId).map((c) => c.id)];
        const rules = rulesInBudget(expenseRules, categoryIds, budget.period);
        const spent = await computeSpent(familyId, requesterId, categoryIds, budget.period, start, end);
        const upcoming = computeUpcoming(rules, budget.period, start, end);
        const amount = Number(budget.amount);
        return { ...budget, amount, spent, upcoming, remaining: amount - spent, recurringIds: rules.map((r) => r.id) };
      })
    );

    res.json(withSpent);
  })
);

// Blank means "no name of its own": the category's name is shown.
const budgetNameSchema = z
  .string()
  .trim()
  .max(60, "Keep the name under 60 characters")
  .nullable()
  .transform((v) => v || null);

const createBudgetSchema = z
  .object({
    categoryId: z.string().min(1),
    name: budgetNameSchema.optional(),
    amount: z.number().finite().gt(0),
    year: z.number().int(),
    month: z.number().int().min(1).max(12).optional(),
    period: z.nativeEnum(BudgetPeriod).default(BudgetPeriod.MONTHLY),
    rollover: z.boolean().default(false),
    repeats: z.boolean().default(false),
    isCommon: z.boolean().default(false),
    // Repeating payments to count in it (they move into its category).
    recurringIds: z.array(z.string().min(1)).max(50).default([]),
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
    if (data.isCommon && category.ownerId) {
      throw new AppError(400, "A family budget needs a family category — this category is personal");
    }
    const month = data.period === BudgetPeriod.ANNUAL ? null : data.month ?? null;
    const rulesToMap = await Promise.all(data.recurringIds.map((id) => findMappableRule(req, id, category.ownerId, data.period)));

    let budget;
    try {
      budget = await prisma.budget.create({
        data: {
          familyId,
          ownerId: data.isCommon ? null : requesterId,
          categoryId: data.categoryId,
          name: data.name ?? null,
          amount: data.amount,
          period: data.period,
          year: data.year,
          month,
          rollover: data.rollover,
          repeats: data.repeats,
        },
        include: { category: { select: BUDGET_CATEGORY_SELECT } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, "A budget already exists for this category and period — edit it instead.");
      }
      throw err;
    }

    const categoryIds = await categoryWithChildren(familyId, category.id);
    const since = budgetPeriodStart(data.period, data.year, month);
    for (const rule of rulesToMap) {
      if (!rule.categoryId || !categoryIds.includes(rule.categoryId)) await moveRuleCategory(rule, category.id, since);
    }

    // The client reloads the list for spent and upcoming.
    res.status(201).json({
      ...budget,
      amount: Number(budget.amount),
      spent: 0,
      upcoming: 0,
      remaining: Number(budget.amount),
      recurringIds: rulesToMap.map((r) => r.id),
    });
  })
);

const updateBudgetSchema = z.object({
  name: budgetNameSchema.optional(),
  amount: z.number().finite().gt(0).optional(),
  rollover: z.boolean().optional(),
  repeats: z.boolean().optional(),
  // true = shared with the family, false = personal to the requester.
  isCommon: z.boolean().optional(),
});

/**
 * Stops the earlier budgets of a series from carrying into later periods. Needed whenever a
 * period's budget leaves its series (deleted, or moved between personal and family), or the
 * previous period's copy would bring it straight back.
 */
function endSeriesBefore(budget: { familyId: string; categoryId: string; ownerId: string | null; period: BudgetPeriod; year: number; month: number | null }) {
  return prisma.budget.updateMany({
    where: {
      familyId: budget.familyId,
      categoryId: budget.categoryId,
      ownerId: budget.ownerId,
      period: budget.period,
      repeats: true,
      ...(budget.period === BudgetPeriod.ANNUAL
        ? { year: { lt: budget.year } }
        : { OR: [{ year: { lt: budget.year } }, { year: budget.year, month: { lt: budget.month ?? 1 } }] }),
    },
    data: { repeats: false },
  });
}

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

    const wasCommon = existing.ownerId === null;
    const becomesCommon = data.isCommon !== undefined && data.isCommon !== wasCommon ? data.isCommon : null;
    if (becomesCommon === true) {
      const category = await prisma.category.findUnique({ where: { id: existing.categoryId } });
      if (category?.ownerId) {
        throw new AppError(400, "Its category is personal — share the category with the family first");
      }
    }

    const updateBudget = prisma.budget.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.rollover !== undefined ? { rollover: data.rollover } : {}),
        ...(data.repeats !== undefined ? { repeats: data.repeats } : {}),
        ...(becomesCommon !== null ? { ownerId: becomesCommon ? null : requesterId } : {}),
      },
      include: { category: { select: BUDGET_CATEGORY_SELECT } },
    });

    let updated;
    try {
      [updated] = becomesCommon !== null ? await prisma.$transaction([updateBudget, endSeriesBefore(existing)]) : [await updateBudget];
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError(409, `There's already a ${becomesCommon ? "family" : "personal"} budget for this category in this period.`);
      }
      throw err;
    }

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

    // Deleting a repeating budget ends it; otherwise last period's copy would add it straight back.
    await prisma.$transaction([prisma.budget.delete({ where: { id: existing.id } }), endSeriesBefore(existing)]);

    res.status(204).send();
  })
);

/**
 * A repeating expense the requester may move into a budget's category: one they can see and change,
 * counted in the budget's kind of period.
 */
async function findMappableRule(req: Request, recurringId: string, categoryOwnerId: string | null, period: BudgetPeriod) {
  const requesterId = req.user!.id;
  const rule = await prisma.recurringTransaction.findFirst({
    where: { id: recurringId, familyId: req.params.familyId },
    include: { account: { select: { ownerId: true } } },
  });
  if (!rule || !isVisible(rule.account.ownerId, requesterId)) throw new AppError(404, "Repeating payment not found");
  if (rule.userId !== requesterId && req.familyMembership!.role !== Role.ADMIN) {
    throw new AppError(403, "Not allowed to change this repeating payment");
  }
  if (rule.type !== TransactionType.EXPENSE) throw new AppError(400, "Only repeating expenses count in a budget");
  if (!countsInPeriod(period, rule.frequency)) {
    throw new AppError(400, "A yearly payment counts in a yearly budget — add it from the Yearly tab.");
  }
  // Its owner would be left with a payment in a category they can't see.
  if (categoryOwnerId && categoryOwnerId !== rule.userId) {
    throw new AppError(400, "This budget's category is personal, so it can't hold another member's payment");
  }
  return rule;
}

async function findVisibleBudget(req: Request) {
  const budget = await prisma.budget.findFirst({
    where: { id: req.params.budgetId, familyId: req.params.familyId },
    include: { category: { select: { ownerId: true } } },
  });
  if (!budget || !isVisible(budget.ownerId, req.user!.id)) throw new AppError(404, "Budget not found");
  return budget;
}

// Counts a repeating payment in a budget: it moves into the budget's category, along with what it
// already recorded this period.
budgetsRouter.put(
  "/:budgetId/recurring/:recurringId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const budget = await findVisibleBudget(req);
    const rule = await findMappableRule(req, req.params.recurringId, budget.category.ownerId, budget.period);
    const categoryIds = await categoryWithChildren(budget.familyId, budget.categoryId);
    if (!rule.categoryId || !categoryIds.includes(rule.categoryId)) {
      await moveRuleCategory(rule, budget.categoryId, budgetPeriodStart(budget.period, budget.year, budget.month));
    }
    res.status(204).send();
  })
);

// Takes a repeating payment out of a budget: it's left without a category from this period on.
budgetsRouter.delete(
  "/:budgetId/recurring/:recurringId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const budget = await findVisibleBudget(req);
    const rule = await findMappableRule(req, req.params.recurringId, null, budget.period);
    const categoryIds = await categoryWithChildren(budget.familyId, budget.categoryId);
    if (rule.categoryId && categoryIds.includes(rule.categoryId)) {
      await moveRuleCategory(rule, null, budgetPeriodStart(budget.period, budget.year, budget.month));
    }
    res.status(204).send();
  })
);
