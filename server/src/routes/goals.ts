import { Router } from "express";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";

export const goalsRouter = Router({ mergeParams: true });
goalsRouter.use(requireAuth);

const GOAL_ACCOUNT_SELECT = {
  id: true,
  name: true,
} satisfies Prisma.AccountSelect;

function isVisible(ownerId: string | null, requesterId: string) {
  return ownerId === null || ownerId === requesterId;
}

function assertCanModify(ownerId: string | null, requesterId: string, role: Role) {
  if (ownerId === null) {
    if (role !== Role.ADMIN) {
      throw new AppError(403, "Only an admin can modify a shared goal");
    }
  } else if (ownerId !== requesterId) {
    throw new AppError(403, "Not allowed to modify this goal");
  }
}

function serializeGoal(goal: {
  id: string;
  familyId: string;
  ownerId: string | null;
  accountId: string | null;
  name: string;
  targetAmount: Prisma.Decimal;
  targetDate: Date | null;
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  account: { id: string; name: string } | null;
  contributions: { amount: Prisma.Decimal }[];
}) {
  const targetAmount = Number(goal.targetAmount);
  const saved = goal.contributions.reduce((sum, c) => sum + Number(c.amount), 0);
  const { contributions: _contributions, ...rest } = goal;
  return {
    ...rest,
    targetAmount,
    saved,
    remaining: Math.max(targetAmount - saved, 0),
    progress: targetAmount > 0 ? Math.min(saved / targetAmount, 1) : 0,
  };
}

goalsRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const goals = await prisma.goal.findMany({
      where: { familyId, OR: [{ ownerId: null }, { ownerId: requesterId }] },
      include: {
        account: { select: GOAL_ACCOUNT_SELECT },
        contributions: { select: { amount: true } },
      },
      orderBy: [{ isCompleted: "asc" }, { createdAt: "desc" }],
    });

    res.json(goals.map(serializeGoal));
  })
);

const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Goal name is required").max(100),
  targetAmount: z.number().finite().gt(0),
  targetDate: z.coerce.date().optional(),
  accountId: z.string().min(1).optional(),
  isCommon: z.boolean().default(false),
});

goalsRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const data = createGoalSchema.parse(req.body);

    if (data.accountId) {
      const account = await prisma.account.findFirst({
        where: { id: data.accountId, familyId },
      });
      if (!account) throw new AppError(404, "Account not found");
      if (!isVisible(account.ownerId, requesterId)) {
        throw new AppError(403, "Cannot link another member's private account");
      }
    }

    const goal = await prisma.goal.create({
      data: {
        familyId,
        ownerId: data.isCommon ? null : requesterId,
        accountId: data.accountId ?? null,
        name: data.name,
        targetAmount: data.targetAmount,
        targetDate: data.targetDate ?? null,
      },
      include: {
        account: { select: GOAL_ACCOUNT_SELECT },
        contributions: { select: { amount: true } },
      },
    });

    res.status(201).json(serializeGoal(goal));
  })
);

const updateGoalSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  targetAmount: z.number().finite().gt(0).optional(),
  targetDate: z.coerce.date().nullable().optional(),
  isCompleted: z.boolean().optional(),
  // true = shared with the family, false = personal to the requester.
  isCommon: z.boolean().optional(),
});

goalsRouter.patch(
  "/:goalId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.goal.findFirst({ where: { id: req.params.goalId, familyId } });
    if (!existing) throw new AppError(404, "Goal not found");
    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    const data = updateGoalSchema.parse(req.body);

    const wasCommon = existing.ownerId === null;
    const becomesCommon = data.isCommon !== undefined && data.isCommon !== wasCommon ? data.isCommon : null;
    if (becomesCommon === false) {
      const othersContributions = await prisma.goalContribution.count({ where: { goalId: existing.id, userId: { not: requesterId } } });
      if (othersContributions > 0) {
        throw new AppError(409, "It can't be made personal: other family members have saved toward it.");
      }
    }

    const updated = await prisma.goal.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.targetAmount !== undefined ? { targetAmount: data.targetAmount } : {}),
        ...(data.targetDate !== undefined ? { targetDate: data.targetDate } : {}),
        ...(data.isCompleted !== undefined ? { isCompleted: data.isCompleted } : {}),
        ...(becomesCommon !== null ? { ownerId: becomesCommon ? null : requesterId } : {}),
      },
      include: {
        account: { select: GOAL_ACCOUNT_SELECT },
        contributions: { select: { amount: true } },
      },
    });

    res.json(serializeGoal(updated));
  })
);

goalsRouter.delete(
  "/:goalId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.goal.findFirst({ where: { id: req.params.goalId, familyId } });
    if (!existing) throw new AppError(404, "Goal not found");
    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    await prisma.goal.delete({ where: { id: existing.id } });

    res.status(204).send();
  })
);

const createContributionSchema = z.object({
  amount: z.number().finite().gt(0),
});

goalsRouter.post(
  "/:goalId/contributions",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const goal = await prisma.goal.findFirst({ where: { id: req.params.goalId, familyId } });
    if (!goal) throw new AppError(404, "Goal not found");
    if (!isVisible(goal.ownerId, requesterId)) {
      throw new AppError(403, "Cannot contribute to another member's private goal");
    }

    const data = createContributionSchema.parse(req.body);

    await prisma.goalContribution.create({
      data: { goalId: goal.id, userId: requesterId, amount: data.amount },
    });

    const contributions = await prisma.goalContribution.findMany({
      where: { goalId: goal.id },
      select: { amount: true },
    });
    const saved = contributions.reduce((sum, c) => sum + Number(c.amount), 0);
    const targetAmount = Number(goal.targetAmount);

    const updated = await prisma.goal.update({
      where: { id: goal.id },
      data: { isCompleted: saved >= targetAmount },
      include: {
        account: { select: GOAL_ACCOUNT_SELECT },
        contributions: { select: { amount: true } },
      },
    });

    res.status(201).json(serializeGoal(updated));
  })
);

goalsRouter.delete(
  "/:goalId/contributions/:contributionId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const goal = await prisma.goal.findFirst({ where: { id: req.params.goalId, familyId } });
    if (!goal) throw new AppError(404, "Goal not found");
    assertCanModify(goal.ownerId, requesterId, req.familyMembership!.role);

    const contribution = await prisma.goalContribution.findFirst({
      where: { id: req.params.contributionId, goalId: goal.id },
    });
    if (!contribution) throw new AppError(404, "Contribution not found");

    await prisma.goalContribution.delete({ where: { id: contribution.id } });

    const contributions = await prisma.goalContribution.findMany({
      where: { goalId: goal.id },
      select: { amount: true },
    });
    const saved = contributions.reduce((sum, c) => sum + Number(c.amount), 0);
    const targetAmount = Number(goal.targetAmount);

    const updated = await prisma.goal.update({
      where: { id: goal.id },
      data: { isCompleted: saved >= targetAmount },
      include: {
        account: { select: GOAL_ACCOUNT_SELECT },
        contributions: { select: { amount: true } },
      },
    });

    res.json(serializeGoal(updated));
  })
);
