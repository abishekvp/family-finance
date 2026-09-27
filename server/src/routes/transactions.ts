import { Router } from "express";
import { z } from "zod";
import { AccountType, ApprovalStatus, Prisma, Role, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { assertEncryptionPolicy, maybeEncryptedText } from "../lib/encryption";
import { initialApprovalStatus } from "../lib/approval";

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
    recurringId: t.recurringId,
    repaysId: t.repaysId,
    approvalStatus: t.approvalStatus,
    reviewedById: t.reviewedById,
    reviewedAt: t.reviewedAt ? t.reviewedAt.toISOString() : null,
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

/**
 * Checks that a return of money lent or borrowed pays back an entry with the same person that moved
 * money the other way, and returns the link to persist. Anything that isn't a transfer with a
 * person carries no link.
 */
async function resolveRepays(
  familyId: string,
  transactionId: string | null,
  type: TransactionType,
  accountId: string,
  transferToAccountId: string | null,
  repaysIdInput: string | null,
  // False when the link is the one already saved: a loan deleted since just drops it.
  requested = true
): Promise<string | null> {
  if (!repaysIdInput || type !== TransactionType.TRANSFER || !transferToAccountId) return null;
  if (repaysIdInput === transactionId) throw new AppError(400, "An entry can't pay back itself");

  const loan = await prisma.transaction.findFirst({
    where: { id: repaysIdInput, familyId, isDeleted: false, type: TransactionType.TRANSFER },
    include: { account: { select: { type: true } }, transferToAccount: { select: { type: true } } },
  });
  if (!loan) {
    if (!requested) return null;
    throw new AppError(404, "The loan being paid back was not found");
  }

  // A loan runs your account → person (lent) or person → your account (borrowed); its return runs
  // the opposite way with the same person.
  const personId =
    loan.transferToAccount?.type === AccountType.PERSON ? loan.transferToAccountId : loan.account.type === AccountType.PERSON ? loan.accountId : null;
  const opposite = !!personId && (personId === loan.transferToAccountId ? accountId === personId : transferToAccountId === personId);
  if (!opposite) {
    // An edit that moved the entry to another person or direction leaves the old link behind.
    if (!requested) return null;
    throw new AppError(400, personId ? "A return has to be with the same person, moving money the other way" : "Only money lent or borrowed can be paid back");
  }
  return loan.id;
}

const transactionTypeSchema = z.nativeEnum(TransactionType);
const transactionStatusSchema = z.nativeEnum(TransactionStatus);
// "ALL" lists every entry whatever its approval state; the default lists only those that count.
const approvalFilterSchema = z.union([z.nativeEnum(ApprovalStatus), z.literal("ALL")]);

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

    let approval: ApprovalStatus | "ALL" = ApprovalStatus.APPROVED;
    if (typeof req.query.approval === "string") {
      const parsedApproval = approvalFilterSchema.safeParse(req.query.approval);
      if (!parsedApproval.success) throw new AppError(400, "Invalid approval filter");
      approval = parsedApproval.data;
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
        // Totals are summed from this list, so by default it holds only what counts.
        ...(approval === "ALL" ? {} : { approvalStatus: approval }),
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

// Rows are read back this far behind the client's position, so one saved just before a sync but
// committed just after it (or stamped by a server whose clock runs slightly behind) isn't skipped.
// Re-sending a few rows is harmless: the client upserts by id.
const SYNC_OVERLAP_MS = 2 * 60 * 1000;
const SYNC_PAGE_SIZE = 1000;

/**
 * Delta sync for clients that keep a local copy of the family's transactions: everything changed
 * after `since` (an opaque position this endpoint handed out), oldest change first, a page at a
 * time. Deleted rows and rows that are no longer visible to the requester (moved onto another
 * member's private account) come back as `removed` ids. So do rows waiting for or refused approval,
 * since clients total whatever they hold; an approval bumps updatedAt, so the row arrives then.
 * `scope` changes whenever an account or category does — a rename, a colour, an account going private — since those are embedded in every
 * row without touching its updatedAt; a client seeing a new scope starts over from scratch.
 */
transactionsRouter.get(
  "/sync",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    // "<updatedAt ISO>_<id>": the last row the client has seen, in (updatedAt, id) order.
    let after: { updatedAt: Date; id: string } | null = null;
    if (typeof req.query.since === "string" && req.query.since) {
      const sep = req.query.since.indexOf("_");
      const updatedAt = new Date(sep > 0 ? req.query.since.slice(0, sep) : "");
      if (sep <= 0 || Number.isNaN(updatedAt.getTime())) throw new AppError(400, "Invalid since position");
      after = { updatedAt, id: req.query.since.slice(sep + 1) };
    }
    // A page continuation resumes exactly where the last page stopped; a fresh sync rewinds a little.
    const isContinuation = req.query.continue === "1";

    const [accounts, categories] = await Promise.all([
      prisma.account.aggregate({ where: { familyId }, _count: true, _max: { updatedAt: true } }),
      prisma.category.aggregate({ where: { familyId }, _count: true, _max: { updatedAt: true } }),
    ]);
    const scope = [
      requesterId,
      accounts._count,
      accounts._max.updatedAt?.getTime() ?? 0,
      categories._count,
      categories._max.updatedAt?.getTime() ?? 0,
    ].join(":");

    let where: Prisma.TransactionWhereInput = { familyId };
    if (after && isContinuation) {
      where = {
        familyId,
        OR: [{ updatedAt: { gt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { gt: after.id } }],
      };
    } else if (after) {
      where = { familyId, updatedAt: { gte: new Date(after.updatedAt.getTime() - SYNC_OVERLAP_MS) } };
    } else {
      // First sync: there's nothing to remove yet, so deleted rows needn't be sent at all.
      where = { familyId, isDeleted: false, approvalStatus: ApprovalStatus.APPROVED };
    }

    const rows = await prisma.transaction.findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: SYNC_PAGE_SIZE + 1,
      include: { ...TRANSACTION_INCLUDE, account: { select: { ...TRANSACTION_INCLUDE.account.select, ownerId: true } } },
    });
    const hasMore = rows.length > SYNC_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, SYNC_PAGE_SIZE) : rows;

    const transactions: ReturnType<typeof serializeTransaction>[] = [];
    const removed: string[] = [];
    for (const row of page) {
      if (row.isDeleted || row.approvalStatus !== ApprovalStatus.APPROVED || !isVisible(row.account.ownerId, requesterId)) {
        removed.push(row.id);
      } else {
        const { ownerId: _ownerId, ...account } = row.account;
        transactions.push(serializeTransaction({ ...row, account }));
      }
    }

    const last = page[page.length - 1];
    res.json({
      transactions,
      removed,
      scope,
      // Where the next request picks up. With nothing new, the client keeps the position it had.
      since: last ? `${last.updatedAt.toISOString()}_${last.id}` : after ? `${after.updatedAt.toISOString()}_${after.id}` : null,
      hasMore,
    });
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
  repaysId: z.string().min(1).nullable().optional(),
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

    const repaysId = await resolveRepays(familyId, null, parsed.type, parsed.accountId, transferToAccountId, parsed.repaysId ?? null);
    // Saved either way, so nothing is lost; with approvals on, a member's entry waits for an admin.
    const approvalStatus = await initialApprovalStatus(familyId, requesterId, [parsed.accountId, transferToAccountId], req.familyMembership!.role);

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
        repaysId,
        approvalStatus,
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

    const repaysId = await resolveRepays(
      familyId,
      existing.id,
      mergedType,
      mergedAccountId,
      transferToAccountId,
      "repaysId" in req.body ? parsed.repaysId ?? null : existing.repaysId,
      "repaysId" in req.body
    );

    const mergedAmount = parsed.amount ?? Number(existing.amount);
    const mergedDate = parsed.date ? new Date(parsed.date) : existing.date;
    const mergedPayee = "payee" in req.body ? parsed.payee ?? null : existing.payee;
    const mergedNotes = "notes" in req.body ? parsed.notes ?? null : existing.notes;
    const mergedStatus = parsed.status ?? existing.status;
    const mergedTags = parsed.tags ?? existing.tags;
    const mergedDueDate = "dueDate" in req.body ? (parsed.dueDate ? new Date(parsed.dueDate) : null) : existing.dueDate;
    // With approvals on, a member's edit goes back for approval (a rejected entry, once fixed, is
    // resubmitted this way). An admin's edit, or any edit with approvals off, leaves it as it was.
    const family = await prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { requireApproval: true } });
    const reviewed =
      family.requireApproval && req.familyMembership!.role !== Role.ADMIN
        ? await initialApprovalStatus(familyId, requesterId, [mergedAccountId, transferToAccountId], req.familyMembership!.role)
        : null;

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
        repaysId,
        ...(reviewed ? { approvalStatus: reviewed, reviewedById: null, reviewedAt: null } : {}),
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

// How many entries wait for an admin. Members see their own count; admins see the whole family's.
transactionsRouter.get(
  "/approvals/summary",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const isAdmin = req.familyMembership!.role === Role.ADMIN;
    const pending = await prisma.transaction.count({
      where: {
        familyId,
        isDeleted: false,
        approvalStatus: ApprovalStatus.PENDING,
        account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
        ...(isAdmin ? {} : { userId: requesterId }),
      },
    });
    res.json({ pending });
  })
);

const reviewSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  decision: z.enum(["APPROVE", "REJECT"]),
});

// Approve or reject waiting entries. Approved ones count from then on; rejected ones stay visible
// (and editable by whoever recorded them, which sends them back for approval) but never count.
transactionsRouter.post(
  "/approvals/review",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const { ids, decision } = reviewSchema.parse(req.body);

    const result = await prisma.transaction.updateMany({
      where: {
        id: { in: ids },
        familyId,
        isDeleted: false,
        // An admin can't see into another member's private account, so can't review what's in it.
        account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
        approvalStatus: { not: decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED },
      },
      data: {
        approvalStatus: decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
        reviewedById: requesterId,
        reviewedAt: new Date(),
      },
    });

    res.json({ updated: result.count });
  })
);
