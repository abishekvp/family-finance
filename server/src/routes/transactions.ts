import { Router } from "express";
import { z } from "zod";
import { AccountType, Prisma, Role, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { assertEncryptionPolicy, maybeEncryptedText } from "../lib/encryption";

export const transactionsRouter = Router({ mergeParams: true });
transactionsRouter.use(requireAuth);

const TRANSACTION_INCLUDE = {
  account: { select: { id: true, name: true, currency: true } },
  transferToAccount: { select: { id: true, name: true } },
  category: { select: { id: true, name: true, color: true, icon: true, type: true } },
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;

function serializeTransaction(t: TransactionWithRelations) {
  return {
    id: t.id,
    familyId: t.familyId,
    accountId: t.accountId,
    transferToAccountId: t.transferToAccountId,
    categoryId: t.categoryId,
    userId: t.userId,
    type: t.type,
    status: t.status,
    amount: Number(t.amount),
    date: t.date.toISOString(),
    payee: t.payee,
    notes: t.notes,
    tags: t.tags,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    account: t.account,
    transferToAccount: t.transferToAccount,
    category: t.category,
  };
}

function isVisible(ownerId: string | null, requesterId: string) {
  return ownerId === null || ownerId === requesterId;
}

function assertCanModify(transactionUserId: string, requesterId: string, role: Role) {
  if (transactionUserId !== requesterId && role !== Role.ADMIN) {
    throw new AppError(403, "Not allowed to edit this transaction");
  }
}

// Validates accountId / transferToAccountId / categoryId against the shared contract rules
// and returns the resolved categoryId / transferToAccountId to persist.
async function resolveRelations(
  familyId: string,
  requesterId: string,
  type: TransactionType,
  accountId: string,
  categoryIdInput: string | null,
  transferToAccountIdInput: string | null
): Promise<{ categoryId: string | null; transferToAccountId: string | null }> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, familyId, isArchived: false },
  });
  if (!account) throw new AppError(404, "Account not found");
  if (!isVisible(account.ownerId, requesterId)) {
    throw new AppError(403, "Cannot post a transaction to another member's private account");
  }

  if (type === TransactionType.TRANSFER) {
    if (!transferToAccountIdInput) {
      throw new AppError(400, "transferToAccountId is required for TRANSFER transactions");
    }
    if (transferToAccountIdInput === accountId) {
      throw new AppError(400, "transferToAccountId must differ from accountId");
    }
    const destAccount = await prisma.account.findFirst({
      where: { id: transferToAccountIdInput, familyId, isArchived: false },
    });
    if (!destAccount) throw new AppError(404, "Transfer destination account not found");
    if (!isVisible(destAccount.ownerId, requesterId)) {
      throw new AppError(403, "Cannot post a transaction to another member's private account");
    }
    // Money lent to or borrowed from a person may say what it was for. It stays a transfer, so the
    // category never counts toward spending, income or budgets. Plain transfers carry none.
    const isLending = account.type === AccountType.PERSON || destAccount.type === AccountType.PERSON;
    if (!isLending || !categoryIdInput) {
      return { categoryId: null, transferToAccountId: transferToAccountIdInput };
    }
    const category = await prisma.category.findFirst({
      where: { id: categoryIdInput, familyId, isArchived: false },
    });
    if (!category) throw new AppError(404, "Category not found");
    if (!isVisible(category.ownerId, requesterId)) {
      throw new AppError(403, "Cannot use another member's private category");
    }
    return { categoryId: categoryIdInput, transferToAccountId: transferToAccountIdInput };
  }

  if (transferToAccountIdInput) {
    throw new AppError(400, "transferToAccountId is only valid for TRANSFER");
  }

  if (categoryIdInput) {
    const category = await prisma.category.findFirst({
      where: { id: categoryIdInput, familyId, isArchived: false },
    });
    if (!category) throw new AppError(404, "Category not found");
    if (!isVisible(category.ownerId, requesterId)) {
      throw new AppError(403, "Cannot use another member's private category");
    }
    if (category.type !== type) {
      throw new AppError(400, "Category type does not match transaction type");
    }
  }

  return { categoryId: categoryIdInput, transferToAccountId: null };
}

const transactionTypeSchema = z.nativeEnum(TransactionType);
const transactionStatusSchema = z.nativeEnum(TransactionStatus);

transactionsRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
    const categoryId = typeof req.query.categoryId === "string" ? req.query.categoryId : undefined;

    let type: TransactionType | undefined;
    if (typeof req.query.type === "string") {
      const parsedType = transactionTypeSchema.safeParse(req.query.type);
      if (!parsedType.success) throw new AppError(400, "Invalid type filter");
      type = parsedType.data;
    }

    // from is an inclusive lower bound, to is an exclusive upper bound — callers pass the
    // start of the next period as "to", never an inclusive end-of-day.
    let from: Date | undefined;
    if (typeof req.query.from === "string") {
      from = new Date(req.query.from);
      if (Number.isNaN(from.getTime())) throw new AppError(400, "Invalid from date");
    }
    let to: Date | undefined;
    if (typeof req.query.to === "string") {
      to = new Date(req.query.to);
      if (Number.isNaN(to.getTime())) throw new AppError(400, "Invalid to date");
    }

    let limit = 50;
    if (typeof req.query.limit === "string") {
      const parsedLimit = Number(req.query.limit);
      if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
        limit = Math.floor(Math.min(parsedLimit, 1000));
      }
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        familyId,
        isDeleted: false,
        // Both legs: what the account paid out and the transfers that landed on it.
        ...(accountId ? { OR: [{ accountId }, { transferToAccountId: accountId }] } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(type ? { type } : {}),
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lt: to } : {}),
              },
            }
          : {}),
        account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: TRANSACTION_INCLUDE,
    });

    res.json(transactions.map(serializeTransaction));
  })
);

const createTransactionSchema = z.object({
  accountId: z.string().min(1, "accountId is required"),
  type: transactionTypeSchema,
  amount: z.number().finite().gt(0, "amount must be greater than 0"),
  date: z.string().datetime().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  transferToAccountId: z.string().min(1).nullable().optional(),
  payee: maybeEncryptedText(200, 2048).nullable().optional(),
  notes: maybeEncryptedText(1000, 8192).nullable().optional(),
  status: transactionStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

const updateTransactionSchema = createTransactionSchema.partial();

transactionsRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const parsed = createTransactionSchema.parse(req.body);
    await assertEncryptionPolicy(familyId, { payee: parsed.payee, notes: parsed.notes });

    const categoryIdInput = parsed.categoryId ?? null;
    const transferToAccountIdInput = parsed.transferToAccountId ?? null;

    const { categoryId, transferToAccountId } = await resolveRelations(
      familyId,
      requesterId,
      parsed.type,
      parsed.accountId,
      categoryIdInput,
      transferToAccountIdInput
    );

    const transaction = await prisma.transaction.create({
      data: {
        familyId,
        userId: requesterId,
        accountId: parsed.accountId,
        transferToAccountId,
        categoryId,
        type: parsed.type,
        status: parsed.status ?? TransactionStatus.CLEARED,
        amount: parsed.amount,
        date: parsed.date ? new Date(parsed.date) : new Date(),
        payee: parsed.payee ?? null,
        notes: parsed.notes ?? null,
        tags: parsed.tags ?? [],
        dueDate: parsed.dueDate ? new Date(parsed.dueDate) : null,
      },
      include: TRANSACTION_INCLUDE,
    });

    res.status(201).json(serializeTransaction(transaction));
  })
);

transactionsRouter.patch(
  "/:transactionId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.transactionId, familyId, isDeleted: false },
    });
    if (!existing) throw new AppError(404, "Transaction not found");

    assertCanModify(existing.userId, requesterId, req.familyMembership!.role);

    const parsed = updateTransactionSchema.parse(req.body);
    await assertEncryptionPolicy(familyId, { payee: parsed.payee, notes: parsed.notes });

    const mergedType = parsed.type ?? existing.type;
    const mergedAccountId = parsed.accountId ?? existing.accountId;

    // resolveRelations drops the category from a transfer that doesn't involve a person.
    const mergedCategoryId: string | null = "categoryId" in req.body ? parsed.categoryId ?? null : existing.categoryId;

    const mergedTransferToAccountId: string | null =
      "transferToAccountId" in req.body ? parsed.transferToAccountId ?? null : existing.transferToAccountId;

    const { categoryId, transferToAccountId } = await resolveRelations(
      familyId,
      requesterId,
      mergedType,
      mergedAccountId,
      mergedCategoryId,
      mergedTransferToAccountId
    );

    const mergedAmount = parsed.amount ?? Number(existing.amount);
    const mergedDate = parsed.date ? new Date(parsed.date) : existing.date;
    const mergedPayee = "payee" in req.body ? parsed.payee ?? null : existing.payee;
    const mergedNotes = "notes" in req.body ? parsed.notes ?? null : existing.notes;
    const mergedStatus = parsed.status ?? existing.status;
    const mergedTags = parsed.tags ?? existing.tags;
    const mergedDueDate = "dueDate" in req.body ? (parsed.dueDate ? new Date(parsed.dueDate) : null) : existing.dueDate;

    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        accountId: mergedAccountId,
        type: mergedType,
        amount: mergedAmount,
        date: mergedDate,
        categoryId,
        transferToAccountId,
        payee: mergedPayee,
        notes: mergedNotes,
        status: mergedStatus,
        tags: mergedTags,
        dueDate: mergedDueDate,
      },
      include: TRANSACTION_INCLUDE,
    });

    res.json(serializeTransaction(updated));
  })
);

transactionsRouter.delete(
  "/:transactionId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.transactionId, familyId, isDeleted: false },
    });
    if (!existing) throw new AppError(404, "Transaction not found");

    assertCanModify(existing.userId, requesterId, req.familyMembership!.role);

    await prisma.transaction.update({
      where: { id: existing.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    res.status(204).send();
  })
);
