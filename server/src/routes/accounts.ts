import { Router } from "express";
import { z } from "zod";
import { AccountType, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";

export const accountsRouter = Router({ mergeParams: true });
accountsRouter.use(requireAuth);

// Accounts are nested under /api/families/:familyId/accounts
accountsRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const accounts = await prisma.account.findMany({
      where: {
        familyId: req.params.familyId,
        isArchived: false,
        OR: [{ ownerId: null }, { ownerId: req.user!.id }],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { owner: { select: { id: true, name: true } } },
    });

    // Balance = opening balance + all non-deleted transactions that post to this account,
    // minus outgoing transfers, plus incoming transfers landing on it.
    // Convention: EXPENSE and outgoing TRANSFER amounts are stored as positive numbers
    // that subtract from the source account; INCOME adds; the incoming leg of a TRANSFER
    // adds to the destination account.
    const withBalances = await Promise.all(
      accounts.map(async (account) => {
        const [outgoingTx, incoming] = await Promise.all([
          prisma.transaction.findMany({
            where: { accountId: account.id, isDeleted: false },
            select: { type: true, amount: true },
          }),
          prisma.transaction.aggregate({
            where: { transferToAccountId: account.id, isDeleted: false, type: "TRANSFER" },
            _sum: { amount: true },
          }),
        ]);

        const delta = outgoingTx.reduce((sum, t) => {
          return t.type === "INCOME" ? sum + Number(t.amount) : sum - Number(t.amount);
        }, 0);
        const incomingTransferTotal = Number(incoming._sum.amount ?? 0);

        return {
          ...account,
          balance: Number(account.openingBalance) + delta + incomingTransferTotal,
        };
      })
    );

    res.json(withBalances);
  })
);

function assertCanModify(ownerId: string | null, requesterId: string, role: Role) {
  if (ownerId === null) {
    if (role !== Role.ADMIN) {
      throw new AppError(403, "Only an admin can modify a shared account");
    }
  } else if (ownerId !== requesterId) {
    throw new AppError(403, "Not allowed to modify this account");
  }
}

const accountTypeSchema = z.nativeEnum(AccountType);

const createAccountSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: accountTypeSchema,
  isCommon: z.boolean().default(false),
  currency: z.string().trim().length(3).default("USD"),
  openingBalance: z.number().finite().default(0),
  creditLimit: z.number().finite().optional(),
  color: z.string().trim().optional(),
  icon: z.string().trim().optional(),
});

accountsRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const data = createAccountSchema.parse(req.body);

    if (!data.isCommon && req.familyMembership!.role === Role.VIEWER) {
      throw new AppError(403, "Viewers cannot create private accounts");
    }

    const account = await prisma.account.create({
      data: {
        familyId: req.params.familyId,
        ownerId: data.isCommon ? null : req.user!.id,
        name: data.name,
        type: data.type,
        currency: data.currency,
        openingBalance: data.openingBalance,
        creditLimit: data.creditLimit,
        color: data.color,
        icon: data.icon,
      },
    });

    res.status(201).json(account);
  })
);

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  type: accountTypeSchema.optional(),
  color: z.string().trim().optional(),
  icon: z.string().trim().optional(),
  openingBalance: z.number().finite().optional(),
  creditLimit: z.number().finite().optional(),
  // true = shared with the family, false = personal to the requester.
  isCommon: z.boolean().optional(),
});

accountsRouter.patch(
  "/:accountId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.account.findFirst({
      where: { id: req.params.accountId, familyId, isArchived: false },
    });
    if (!existing) throw new AppError(404, "Account not found");

    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    const data = updateAccountSchema.parse(req.body);

    const wasCommon = existing.ownerId === null;
    const becomesCommon = data.isCommon !== undefined && data.isCommon !== wasCommon ? data.isCommon : null;
    if (becomesCommon === false) {
      // Other members would lose sight of their own entries on it.
      const [othersTransactions, othersRepeating, othersGoals] = await Promise.all([
        prisma.transaction.count({
          where: { familyId, isDeleted: false, userId: { not: requesterId }, OR: [{ accountId: existing.id }, { transferToAccountId: existing.id }] },
        }),
        prisma.recurringTransaction.count({ where: { familyId, accountId: existing.id, userId: { not: requesterId } } }),
        prisma.goal.count({ where: { familyId, accountId: existing.id, OR: [{ ownerId: null }, { ownerId: { not: requesterId } }] } }),
      ]);
      if (othersTransactions > 0 || othersRepeating > 0 || othersGoals > 0) {
        const uses = [
          othersTransactions > 0 ? `${othersTransactions} transaction${othersTransactions === 1 ? "" : "s"}` : null,
          othersRepeating > 0 ? `${othersRepeating} repeating payment${othersRepeating === 1 ? "" : "s"}` : null,
          othersGoals > 0 ? `${othersGoals} shared goal${othersGoals === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" and ");
        throw new AppError(409, `It can't be made personal: other family members use it in ${uses}.`);
      }
    }

    const updated = await prisma.account.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...(data.openingBalance !== undefined ? { openingBalance: data.openingBalance } : {}),
        ...(data.creditLimit !== undefined ? { creditLimit: data.creditLimit } : {}),
        ...(becomesCommon !== null ? { ownerId: becomesCommon ? null : requesterId } : {}),
      },
    });

    // Client refetches the account list (which recomputes balance) after a save,
    // so the raw updated row is returned here rather than duplicating that calc.
    res.json(updated);
  })
);

accountsRouter.delete(
  "/:accountId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.account.findFirst({
      where: { id: req.params.accountId, familyId, isArchived: false },
    });
    if (!existing) throw new AppError(404, "Account not found");

    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    await prisma.account.update({
      where: { id: existing.id },
      data: { isArchived: true },
    });

    res.status(204).send();
  })
);
