import { Router } from "express";
import { z } from "zod";
import { BudgetPeriod, CategoryType, Prisma, Role, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
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

async function computeSpent(familyId: string, requesterId: string, categoryId: string, start: Date, end: Date) {
  const spentAgg = await prisma.transaction.aggregate({
    where: {
      familyId,
      categoryId,
      type: TransactionType.EXPENSE,
      isDeleted: false,
      date: { gte: start, lt: end },
      account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
    },
    _sum: { amount: true },
  });
  return Number(spentAgg._sum.amount ?? 0);
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

    const budgets = await prisma.budget.findMany({
      where: {
        familyId,
        OR: [{ ownerId: null }, { ownerId: requesterId }],
        ...(year !== undefined ? { year } : {}),
        ...(month !== undefined ? { month } : {}),
      },
      include: { category: { select: BUDGET_CATEGORY_SELECT } },
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "asc" }],
    });

    const withSpent = await Promise.all(
      budgets.map(async (budget) => {
        const { start, end } = periodRange(budget.period, budget.year, budget.month);
        const spent = await computeSpent(familyId, requesterId, budget.categoryId, start, end);
        const amount = Number(budget.amount);
        return { ...budget, amount, spent, remaining: amount - spent };
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
        },
        include: { category: { select: BUDGET_CATEGORY_SELECT } },
      });

      res.status(201).json({ ...budget, amount: Number(budget.amount), spent: 0, remaining: Number(budget.amount) });
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
