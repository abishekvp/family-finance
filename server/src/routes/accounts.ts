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
