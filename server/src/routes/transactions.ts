import { Router } from "express";
import { z } from "zod";
import { AccountType, ApprovalStatus, Prisma, Role, TransactionStatus, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { checkEncryptionPolicy, maybeEncryptedText } from "../lib/encryption";
import { initialApprovalStatus } from "../lib/approval";
import { BALANCE_TX_OPTIONS, lockAccounts, recalculateAccountBalances } from "../lib/balances";
import { WRITE_OFF_TAG } from "../lib/tags";
import { TRANSACTION_SEEN_BY, USABLE_BY, canSeeAccount, canUseAccount, isSharedByOther } from "../lib/visibility";

export const transactionsRouter = Router({ mergeParams: true });
transactionsRouter.use(requireAuth);

// Who owns each end, so an entry can be shown to someone who can't see one of them (see accountFor).
const ACCOUNT_ACCESS = { ownerId: true, sharedWithFamily: true, owner: { select: { firstName: true, name: true } } } as const;

const TRANSACTION_INCLUDE = {
  account: { select: { id: true, name: true, currency: true, ...ACCOUNT_ACCESS } },
  transferToAccount: { select: { id: true, name: true, ...ACCOUNT_ACCESS } },
  category: { select: { id: true, name: true, color: true, icon: true, type: true } },
  // Only entries whose refund still counts mark this one as refunded (see COUNTED in lib/approval).
  refundedBy: { where: { isDeleted: false, approvalStatus: ApprovalStatus.APPROVED }, select: { id: true, amount: true } },
  // Write-offs closing this loan (see resolveRepays): marks it as money that won't come back.
  repayments: {
    where: { isDeleted: false, approvalStatus: ApprovalStatus.APPROVED, type: { not: TransactionType.TRANSFER }, tags: { has: WRITE_OFF_TAG } },
    select: { id: true, amount: true },
  },
} satisfies Prisma.TransactionInclude;

type TransactionWithRelations = Prisma.TransactionGetPayload<{ include: typeof TRANSACTION_INCLUDE }>;
type AccountEnd = TransactionWithRelations["account"] | NonNullable<TransactionWithRelations["transferToAccount"]>;

/**
 * One end of an entry as the requester may see it. A member's private account at the other end of a
 * transfer they can see — money a member sent to the family, or to you — shows only whose it is.
 */
function accountFor(account: AccountEnd, requesterId: string) {
  const { ownerId, sharedWithFamily, owner, ...rest } = account;
  if (canSeeAccount({ ownerId, sharedWithFamily }, requesterId)) return rest;
  const whose = owner?.firstName.trim() || owner?.name.trim() || "A member";
  return { ...rest, name: `${whose}'s account` };
}

function serializeTransaction(t: TransactionWithRelations, requesterId: string) {
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
    // Non-null when this entry gives back another one: a refund (income) of an expense, or money
    // returned (an expense) out of an income. It never counts in income/spending totals itself;
    // instead it takes its amount off the entry it reverses (see resolveRefunds).
    refundsId: t.refundsId,
    // True once a live refund points back at this entry; `refundedAmount` is how much of it came
    // back, so a partial refund only takes that much off what the entry counts for.
    isRefunded: t.refundedBy.length > 0,
    refundedAmount: t.refundedBy.reduce((sum, r) => sum + Number(r.amount), 0),
    // How much of this loan was written off as not coming back (0 when none, or not a loan).
    writtenOffAmount: t.repayments.reduce((sum, r) => sum + Number(r.amount), 0),
    approvalStatus: t.approvalStatus,
    reviewedById: t.reviewedById,
    reviewedAt: t.reviewedAt ? t.reviewedAt.toISOString() : null,
    isDeleted: t.isDeleted,
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    account: accountFor(t.account, requesterId),
    transferToAccount: t.transferToAccount ? accountFor(t.transferToAccount, requesterId) : null,
    category: t.category,
    // Seen only because a family member shares their account with the family: theirs to look at, not
    // yours — clients leave it out of your own totals unless they're showing the family's.
    sharedView: !canUseAccount(t.account, requesterId) && !(t.transferToAccount && canUseAccount(t.transferToAccount, requesterId)),
    // Recorded on an account the requester doesn't use (a member's money sent to them or to the family,
    // or a shared account's entries): shown, but never edited by them.
    readOnly: !canUseAccount(t.account, requesterId),
  };
}

/** Transactions touching an account the requester uses — or, with `shared`, any account they see. */
function visibleTo(requesterId: string, shared: boolean): Prisma.TransactionWhereInput {
  if (shared) return TRANSACTION_SEEN_BY(requesterId);
  return { OR: [{ account: USABLE_BY(requesterId) }, { transferToAccount: USABLE_BY(requesterId) }] };
}

/**
 * Whoever recorded an entry may change it; so may an admin, but only on accounts they use — never
 * another member's entries on that member's own account, even one shared with the family to look at.
 */
async function assertCanModify(existing: { userId: string; accountId: string }, requesterId: string, role: Role) {
  if (existing.userId === requesterId) return;
  if (role !== Role.ADMIN) throw new AppError(403, "Not allowed to edit this transaction");
  const account = await prisma.account.findUnique({ where: { id: existing.accountId }, select: { ownerId: true } });
  if (!account || !canUseAccount(account, requesterId)) throw new AppError(403, "Not allowed to edit another member's transaction");
}

/**
 * What an edited entry is already linked to. Those links stay usable after their account or category
 * is archived — a person removed from Lend & borrow, a deleted category — so the entry can still be
 * edited without first being moved somewhere else.
 */
interface ExistingLinks {
  accountIds: (string | null)[];
  categoryId: string | null;
}

// Validates accountId / transferToAccountId / categoryId against the shared contract rules
// and returns the resolved categoryId / transferToAccountId to persist.
async function resolveRelations(
  familyId: string,
  requesterId: string,
  type: TransactionType,
  accountId: string,
  categoryIdInput: string | null,
  transferToAccountIdInput: string | null,
  existing: ExistingLinks = { accountIds: [], categoryId: null }
): Promise<{ categoryId: string | null; transferToAccountId: string | null }> {
  if (type === TransactionType.TRANSFER) {
    if (!transferToAccountIdInput) {
      throw new AppError(400, "transferToAccountId is required for TRANSFER transactions");
    }
    if (transferToAccountIdInput === accountId) {
      throw new AppError(400, "transferToAccountId must differ from accountId");
    }
  } else if (transferToAccountIdInput) {
    throw new AppError(400, "transferToAccountId is only valid for TRANSFER");
  }

  // One round trip for everything the entry points at.
  const accountIds = type === TransactionType.TRANSFER ? [accountId, transferToAccountIdInput!] : [accountId];
  const [accounts, category] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: accountIds }, familyId } }),
    categoryIdInput ? prisma.category.findFirst({ where: { id: categoryIdInput, familyId } }) : Promise.resolve(null),
  ]);
  const usableAccount = (id: string) => {
    const found = accounts.find((a) => a.id === id);
    return found && (!found.isArchived || existing.accountIds.includes(id)) ? found : null;
  };
  const usableCategory = category && (!category.isArchived || category.id === existing.categoryId) ? category : null;

  const account = usableAccount(accountId);
  if (!account) throw new AppError(404, "Account not found");
  if (!canUseAccount(account, requesterId)) {
    throw new AppError(403, "Cannot post a transaction to another member's private account");
  }

  if (type === TransactionType.TRANSFER) {
    const destAccount = usableAccount(transferToAccountIdInput!);
    if (!destAccount) throw new AppError(404, "Transfer destination account not found");
    // Money sent to a family member goes into an account they share with the family (or, on an edit,
    // the one it already went to, should they have stopped sharing it since).
    const toMember = isSharedByOther(destAccount, requesterId) || existing.accountIds.includes(destAccount.id);
    if (!canUseAccount(destAccount, requesterId) && !toMember) {
      throw new AppError(403, "Cannot post a transaction to another member's private account");
    }
    // Money lent to or borrowed from a person may say what it was for. It stays a transfer, so the
    // category never counts toward spending, income or budgets. Plain transfers carry none.
    const isLending = account.type === AccountType.PERSON || destAccount.type === AccountType.PERSON;
    if (!isLending || !categoryIdInput) {
      return { categoryId: null, transferToAccountId: transferToAccountIdInput };
    }
    if (!usableCategory) throw new AppError(404, "Category not found");
    if (usableCategory.ownerId !== null && usableCategory.ownerId !== requesterId) {
      throw new AppError(403, "Cannot use another member's private category");
    }
    return { categoryId: categoryIdInput, transferToAccountId: transferToAccountIdInput };
  }

  if (categoryIdInput) {
    if (!usableCategory) throw new AppError(404, "Category not found");
    if (usableCategory.ownerId !== null && usableCategory.ownerId !== requesterId) {
      throw new AppError(403, "Cannot use another member's private category");
    }
    if (usableCategory.type !== type) {
      throw new AppError(400, "Category type does not match transaction type");
    }
  }

  return { categoryId: categoryIdInput, transferToAccountId: null };
}

/**
 * Checks the loan an entry settles and returns the link to persist. Two kinds of entry settle one:
 *  - a return: a transfer with the same person, moving money the other way;
 *  - a write-off (money that won't come back): an expense posted on the person's own account closes
 *    money you lent them, an income closes money you borrowed from them.
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
  if (!repaysIdInput) return null;
  const isTransfer = type === TransactionType.TRANSFER;
  if (isTransfer && !transferToAccountId) return null;
  if (repaysIdInput === transactionId) throw new AppError(400, "An entry can't pay back itself");

  const loan = await prisma.transaction.findFirst({
    where: { id: repaysIdInput, familyId, isDeleted: false, type: TransactionType.TRANSFER },
    include: { account: { select: { type: true } }, transferToAccount: { select: { type: true } } },
  });
  if (!loan) {
    if (!requested) return null;
    throw new AppError(404, "The loan being paid back was not found");
  }

  // A loan runs your account → person (lent) or person → your account (borrowed).
  const personId =
    loan.transferToAccount?.type === AccountType.PERSON ? loan.transferToAccountId : loan.account.type === AccountType.PERSON ? loan.accountId : null;
  const lentToThem = !!personId && personId === loan.transferToAccountId;
  const settles = !personId
    ? false
    : isTransfer
      ? lentToThem
        ? accountId === personId
        : transferToAccountId === personId
      : accountId === personId && (type === TransactionType.EXPENSE ? lentToThem : !lentToThem);
  if (!settles) {
    // An edit that moved the entry to another person or direction leaves the old link behind.
    if (!requested) return null;
    throw new AppError(
      400,
      !personId
        ? "Only money lent or borrowed can be paid back"
        : isTransfer
          ? "A return has to be with the same person, moving money the other way"
          : "A write-off has to be on the same person, closing money that moved the other way"
    );
  }
  return loan.id;
}

/**
 * Checks that a refund or return reverses an entry of the opposite kind in the same family, and
 * returns the link to persist:
 *  - money coming back (INCOME) can refund an EXPENSE — a cancelled order, a card verification
 *    charge reversed straight away, a subscription refunded;
 *  - money handed back (EXPENSE) can return an INCOME — a payment received by mistake, a deposit
 *    returned.
 * Partial refunds are allowed, but all of an entry's refunds together can't exceed it.
 */
async function resolveRefunds(
  familyId: string,
  transactionId: string | null,
  type: TransactionType,
  amount: number,
  refundsIdInput: string | null,
  // False when the link is the one already saved: an original deleted since just drops it.
  requested = true
): Promise<string | null> {
  if (!refundsIdInput) return null;
  if (refundsIdInput === transactionId) throw new AppError(400, "An entry can't refund itself");
  if (type === TransactionType.TRANSFER) {
    if (!requested) return null;
    throw new AppError(400, "Only an income or an expense can be marked as a refund or return");
  }
  const originalType = type === TransactionType.INCOME ? TransactionType.EXPENSE : TransactionType.INCOME;

  const original = await prisma.transaction.findFirst({
    where: { id: refundsIdInput, familyId, isDeleted: false, type: originalType },
    include: {
      refundedBy: {
        where: { isDeleted: false, approvalStatus: ApprovalStatus.APPROVED, ...(transactionId ? { id: { not: transactionId } } : {}) },
        select: { amount: true },
      },
    },
  });
  if (!original) {
    if (!requested) return null;
    throw new AppError(404, type === TransactionType.INCOME ? "The expense being refunded was not found" : "The income being returned was not found");
  }
  if (original.refundsId) {
    if (!requested) return null;
    throw new AppError(400, "That entry is itself a refund or return");
  }
  if (requested) {
    const alreadyBack = original.refundedBy.reduce((sum, r) => sum + Number(r.amount), 0);
    const left = Number(original.amount) - alreadyBack;
    if (amount > left + 0.005) {
      throw new AppError(400, left > 0.005 ? `Only ${left.toFixed(2)} of that entry is left to refund` : "That entry has already been fully refunded");
    }
  }
  return original.id;
}

/**
 * Bumps updatedAt on entries whose refunded or written-off amount just changed (a refund, return or
 * write-off pointing at them was added, edited, moved, deleted or restored). Their own row didn't
 * change, so without this the delta sync would never send them again and other devices would keep
 * counting them as before.
 */
async function touchLinked(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
  if (unique.length === 0) return;
  await tx.transaction.updateMany({ where: { id: { in: unique } }, data: { updatedAt: new Date() } });
}

/**
 * Permanently deletes entries from the bin. Entries that pointed at them (a refund, a loan's return)
 * lose the link as they go, so their updatedAt is bumped too — otherwise synced devices would keep the
 * link they hold and count them differently from the server.
 */
async function purgeTransactions(familyId: string, ids: string[]) {
  if (ids.length === 0) return;
  await prisma.$transaction([
    prisma.transaction.updateMany({
      where: { familyId, id: { notIn: ids }, OR: [{ refundsId: { in: ids } }, { repaysId: { in: ids } }] },
      data: { updatedAt: new Date() },
    }),
    prisma.transaction.deleteMany({ where: { familyId, id: { in: ids } } }),
  ]);
}

// Entries stay in the bin this long before they're deleted for good.
const BIN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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
        // High enough that a client caching a whole year at once (see FamilyDataContext) doesn't
        // silently truncate for an active family.
        limit = Math.floor(Math.min(parsedLimit, 5000));
      }
    }

    const isBin = req.query.bin === "true";
    // Also the entries on accounts other members share with the family (see Account.sharedWithFamily).
    const shared = req.query.shared === "true";

    // Opening the bin empties out what has been in it past the retention period. Awaited: a serverless
    // function is frozen as soon as it responds, so a fire-and-forget delete might never run.
    if (isBin) {
      const expired = await prisma.transaction.findMany({
        where: { familyId, isDeleted: true, deletedAt: { lt: new Date(Date.now() - BIN_RETENTION_MS) } },
        select: { id: true },
      });
      await purgeTransactions(
        familyId,
        expired.map((t) => t.id)
      );
    }

    const transactions = await prisma.transaction.findMany({
      where: {
        familyId,
        isDeleted: isBin,
        // Totals are summed from this list, so by default it holds only what counts.
        ...(approval === "ALL" ? {} : { approvalStatus: approval }),
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
        AND: [
          // Both legs: what the account paid out and the transfers that landed on it.
          ...(accountId ? [{ OR: [{ accountId }, { transferToAccountId: accountId }] }] : []),
          visibleTo(requesterId, shared || !!accountId),
        ],
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
      include: TRANSACTION_INCLUDE,
    });

    res.json(transactions.map((t) => serializeTransaction(t, requesterId)));
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
    // Newer apps also keep the entries on accounts other members share with the family (each marked
    // sharedView); older ones don't know to leave those out of their totals, so they never get them.
    const shared = req.query.shared === "true";

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
      shared ? "shared" : "own",
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
      include: TRANSACTION_INCLUDE,
    });
    const hasMore = rows.length > SYNC_PAGE_SIZE;
    const page = hasMore ? rows.slice(0, SYNC_PAGE_SIZE) : rows;

    // A row is kept while either end is an account the member sees (or, without `shared`, uses).
    const seen = (end: AccountEnd | null) => !!end && (shared ? canSeeAccount(end, requesterId) : canUseAccount(end, requesterId));
    const transactions: ReturnType<typeof serializeTransaction>[] = [];
    const removed: string[] = [];
    for (const row of page) {
      if (row.isDeleted || row.approvalStatus !== ApprovalStatus.APPROVED || !(seen(row.account) || seen(row.transferToAccount))) {
        removed.push(row.id);
      } else {
        transactions.push(serializeTransaction(row, requesterId));
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
  id: z.string().optional(),
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
  refundsId: z.string().min(1).nullable().optional(),
});

const updateTransactionSchema = createTransactionSchema.partial();

transactionsRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const parsed = createTransactionSchema.parse(req.body);

    const categoryIdInput = parsed.categoryId ?? null;
    const transferToAccountIdInput = parsed.transferToAccountId ?? null;

    // Independent checks, run side by side: every one of them is a round trip to the database.
    const [family, { categoryId, transferToAccountId }, repaysId, refundsId] = await Promise.all([
      prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { encryptionEnabled: true, requireApproval: true } }),
      resolveRelations(familyId, requesterId, parsed.type, parsed.accountId, categoryIdInput, transferToAccountIdInput),
      resolveRepays(familyId, null, parsed.type, parsed.accountId, transferToAccountIdInput, parsed.repaysId ?? null),
      resolveRefunds(familyId, null, parsed.type, parsed.amount, parsed.refundsId ?? null),
    ]);
    checkEncryptionPolicy(family.encryptionEnabled, { payee: parsed.payee, notes: parsed.notes });
    // Saved either way, so nothing is lost; with approvals on, a member's entry waits for an admin.
    const approvalStatus = await initialApprovalStatus(
      familyId,
      requesterId,
      [parsed.accountId, transferToAccountId],
      req.familyMembership!.role,
      family.requireApproval
    );

    const transaction = await prisma.$transaction(async (tx) => {
      await lockAccounts(tx, [parsed.accountId, transferToAccountId]);
      const created = await tx.transaction.create({
        data: {
          id: parsed.id,
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
          refundsId,
          approvalStatus,
        },
        include: TRANSACTION_INCLUDE,
      });
      await recalculateAccountBalances(tx, [parsed.accountId, transferToAccountId]);
      await touchLinked(tx, [refundsId, repaysId]);
      return created;
    }, BALANCE_TX_OPTIONS);

    res.status(201).json(serializeTransaction(transaction, requesterId));
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

    await assertCanModify(existing, requesterId, req.familyMembership!.role);

    const parsed = updateTransactionSchema.parse(req.body);

    const mergedType = parsed.type ?? existing.type;
    const mergedAccountId = parsed.accountId ?? existing.accountId;

    // resolveRelations drops the category from a transfer that doesn't involve a person.
    const mergedCategoryId: string | null = "categoryId" in req.body ? parsed.categoryId ?? null : existing.categoryId;

    const mergedTransferToAccountId: string | null =
      "transferToAccountId" in req.body ? parsed.transferToAccountId ?? null : existing.transferToAccountId;

    const mergedAmount = parsed.amount ?? Number(existing.amount);
    // Independent checks, run side by side: every one of them is a round trip to the database.
    const [family, { categoryId, transferToAccountId }, repaysId, refundsId] = await Promise.all([
      prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { encryptionEnabled: true, requireApproval: true } }),
      resolveRelations(familyId, requesterId, mergedType, mergedAccountId, mergedCategoryId, mergedTransferToAccountId, {
        accountIds: [existing.accountId, existing.transferToAccountId],
        categoryId: existing.categoryId,
      }),
      resolveRepays(
        familyId,
        existing.id,
        mergedType,
        mergedAccountId,
        mergedType === TransactionType.TRANSFER ? mergedTransferToAccountId : null,
        "repaysId" in req.body ? parsed.repaysId ?? null : existing.repaysId,
        "repaysId" in req.body
      ),
      resolveRefunds(
        familyId,
        existing.id,
        mergedType,
        mergedAmount,
        "refundsId" in req.body ? parsed.refundsId ?? null : existing.refundsId,
        "refundsId" in req.body
      ),
    ]);
    checkEncryptionPolicy(family.encryptionEnabled, { payee: parsed.payee, notes: parsed.notes });
    const mergedDate = parsed.date ? new Date(parsed.date) : existing.date;
    const mergedPayee = "payee" in req.body ? parsed.payee ?? null : existing.payee;
    const mergedNotes = "notes" in req.body ? parsed.notes ?? null : existing.notes;
    const mergedStatus = parsed.status ?? existing.status;
    const mergedTags = parsed.tags ?? existing.tags;
    const mergedDueDate = "dueDate" in req.body ? (parsed.dueDate ? new Date(parsed.dueDate) : null) : existing.dueDate;
    // With approvals on, a member's edit goes back for approval (a rejected entry, once fixed, is
    // resubmitted this way). An admin's edit, or any edit with approvals off, leaves it as it was.
    const reviewed =
      family.requireApproval && req.familyMembership!.role !== Role.ADMIN
        ? await initialApprovalStatus(familyId, requesterId, [mergedAccountId, transferToAccountId], req.familyMembership!.role, true)
        : null;

    const touchedAccounts = [existing.accountId, existing.transferToAccountId, mergedAccountId, transferToAccountId];
    const updated = await prisma.$transaction(async (tx) => {
      await lockAccounts(tx, touchedAccounts);
      const updatedTx = await tx.transaction.update({
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
          refundsId,
          ...(reviewed ? { approvalStatus: reviewed, reviewedById: null, reviewedAt: null } : {}),
        },
        include: TRANSACTION_INCLUDE,
      });
      await recalculateAccountBalances(tx, touchedAccounts);
      await touchLinked(tx, [existing.refundsId, refundsId, existing.repaysId, repaysId]);
      return updatedTx;
    }, BALANCE_TX_OPTIONS);

    res.json(serializeTransaction(updated, requesterId));
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

    await assertCanModify(existing, requesterId, req.familyMembership!.role);

    await prisma.$transaction(async (tx) => {
      await lockAccounts(tx, [existing.accountId, existing.transferToAccountId]);
      await tx.transaction.update({
        where: { id: existing.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      await recalculateAccountBalances(tx, [existing.accountId, existing.transferToAccountId]);
      await touchLinked(tx, [existing.refundsId, existing.repaysId]);
    }, BALANCE_TX_OPTIONS);

    res.status(204).send();
  })
);

const bulkDeleteSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
});

transactionsRouter.post(
  "/bulk-delete",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const parsed = bulkDeleteSchema.parse(req.body);

    const from = parsed.from ? new Date(parsed.from) : undefined;
    const to = parsed.to ? new Date(parsed.to) : undefined;
    if (from && Number.isNaN(from.getTime())) throw new AppError(400, "Invalid from date");
    if (to && Number.isNaN(to.getTime())) throw new AppError(400, "Invalid to date");

    const whereClause = {
      familyId,
      isDeleted: false,
      ...(req.familyMembership!.role !== Role.ADMIN ? { userId: requesterId } : {}),
      account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
      ...(parsed.accountId ? { accountId: parsed.accountId } : {}),
      ...(parsed.categoryId ? { categoryId: parsed.categoryId } : {}),
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
    };

    const result = await prisma.$transaction(async (tx) => {
      // Find which accounts are affected
      const affected = await tx.transaction.findMany({
        where: whereClause,
        select: { accountId: true, transferToAccountId: true, refundsId: true, repaysId: true },
      });
      const accountIds = new Set<string>();
      for (const t of affected) {
        accountIds.add(t.accountId);
        if (t.transferToAccountId) accountIds.add(t.transferToAccountId);
      }

      const updateResult = await tx.transaction.updateMany({
        where: whereClause,
        data: { isDeleted: true, deletedAt: new Date() },
      });

      await recalculateAccountBalances(tx, Array.from(accountIds));
      await touchLinked(tx, affected.flatMap((t) => [t.refundsId, t.repaysId]));
      return updateResult;
    }, BALANCE_TX_OPTIONS);

    res.json({ deletedCount: result.count });
  })
);

transactionsRouter.post(
  "/:transactionId/restore",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.transactionId, familyId, isDeleted: true },
    });
    if (!existing) throw new AppError(404, "Transaction not found in bin");

    await assertCanModify(existing, requesterId, req.familyMembership!.role);

    const restored = await prisma.$transaction(async (tx) => {
      await lockAccounts(tx, [existing.accountId, existing.transferToAccountId]);
      // A person deleted together with their entries comes back with any one of them.
      await tx.account.updateMany({
        where: { id: { in: [existing.accountId, existing.transferToAccountId].filter((id): id is string => !!id) }, type: AccountType.PERSON, isArchived: true },
        data: { isArchived: false },
      });
      const updated = await tx.transaction.update({
        where: { id: existing.id },
        data: { isDeleted: false, deletedAt: null },
        include: TRANSACTION_INCLUDE,
      });
      await recalculateAccountBalances(tx, [updated.accountId, updated.transferToAccountId]);
      await touchLinked(tx, [updated.refundsId, updated.repaysId]);
      return updated;
    }, BALANCE_TX_OPTIONS);

    res.json(serializeTransaction(restored, requesterId));
  })
);

/**
 * Takes back a loan's write-offs: they go to the bin (where they can still be restored) and the money
 * counts as owed again. Returns the loan as it now stands.
 */
transactionsRouter.post(
  "/:transactionId/cancel-write-off",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const role = req.familyMembership!.role;

    const loan = await prisma.transaction.findFirst({
      where: { id: req.params.transactionId, familyId, isDeleted: false, type: TransactionType.TRANSFER },
      include: {
        repayments: {
          where: { isDeleted: false, type: { not: TransactionType.TRANSFER }, tags: { has: WRITE_OFF_TAG } },
          select: { id: true, userId: true, accountId: true },
        },
      },
    });
    if (!loan) throw new AppError(404, "Loan not found");
    if (loan.repayments.length === 0) throw new AppError(400, "Nothing on this loan has been written off");
    for (const writeOff of loan.repayments) await assertCanModify(writeOff, requesterId, role);

    const updated = await prisma.$transaction(async (tx) => {
      const accountIds = loan.repayments.map((w) => w.accountId);
      await lockAccounts(tx, accountIds);
      await tx.transaction.updateMany({
        where: { id: { in: loan.repayments.map((w) => w.id) } },
        data: { isDeleted: true, deletedAt: new Date() },
      });
      await recalculateAccountBalances(tx, accountIds);
      await touchLinked(tx, [loan.id]);
      return tx.transaction.findUniqueOrThrow({ where: { id: loan.id }, include: TRANSACTION_INCLUDE });
    }, BALANCE_TX_OPTIONS);

    res.json(serializeTransaction(updated, requesterId));
  })
);

transactionsRouter.delete(
  "/:transactionId/purge",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.transaction.findFirst({
      where: { id: req.params.transactionId, familyId, isDeleted: true },
    });
    if (!existing) throw new AppError(404, "Transaction not found in bin");

    await assertCanModify(existing, requesterId, req.familyMembership!.role);

    await purgeTransactions(familyId, [existing.id]);

    res.status(204).send();
  })
);

const resetSchema = z.object({
  confirm: z.literal(true),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

/**
 * Wipes the money history: every transaction (soft-deleted, so synced devices drop them) and every
 * account's opening balance, leaving all balances at zero. Accounts, categories, budgets, goals and
 * repeating payments stay. Only reaches accounts the admin can see, never another member's private ones.
 * If a date range is provided, only transactions in that range are deleted, and opening balances are kept.
 */
transactionsRouter.post(
  "/reset",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const visible = { OR: [{ ownerId: null }, { ownerId: req.user!.id }] };
    const { startDate, endDate } = resetSchema.parse(req.body);

    // Same bounds as everywhere else: start inclusive, end exclusive.
    const dateFilter: Prisma.DateTimeFilter = {};
    if (startDate) dateFilter.gte = new Date(startDate);
    if (endDate) dateFilter.lt = new Date(endDate);
    const hasDateFilter = startDate || endDate;

    const { transactions, accounts } = await prisma.$transaction(async (tx) => {
      // Find affected accounts
      const affected = await tx.transaction.findMany({
        where: {
          familyId,
          isDeleted: false,
          account: visible,
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
        select: { accountId: true, transferToAccountId: true, refundsId: true, repaysId: true },
      });
      const accountIds = new Set<string>();
      for (const t of affected) {
        accountIds.add(t.accountId);
        if (t.transferToAccountId) accountIds.add(t.transferToAccountId);
      }

      const txResult = await tx.transaction.updateMany({
        where: {
          familyId,
          isDeleted: false,
          account: visible,
          ...(hasDateFilter ? { date: dateFilter } : {}),
        },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      let accountsResult = { count: 0 };
      if (!hasDateFilter) {
        accountsResult = await tx.account.updateMany({
          where: { familyId, ...visible },
          data: { openingBalance: 0, currentBalance: 0 },
        });
      }

      await recalculateAccountBalances(tx, Array.from(accountIds));
      await touchLinked(tx, affected.flatMap((t) => [t.refundsId, t.repaysId]));

      return { transactions: txResult, accounts: accountsResult };
    }, BALANCE_TX_OPTIONS);

    res.json({ transactionsCleared: transactions.count, accountsReset: accounts ? accounts.count : 0 });
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

    const whereClause = {
      id: { in: ids },
      familyId,
      isDeleted: false,
      account: { OR: [{ ownerId: null }, { ownerId: requesterId }] },
      approvalStatus: { not: decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED },
    };

    const result = await prisma.$transaction(async (tx) => {
      const affected = await tx.transaction.findMany({
        where: whereClause,
        select: { accountId: true, transferToAccountId: true, refundsId: true, repaysId: true },
      });
      const accountIds = new Set<string>();
      for (const t of affected) {
        accountIds.add(t.accountId);
        if (t.transferToAccountId) accountIds.add(t.transferToAccountId);
      }

      const updateResult = await tx.transaction.updateMany({
        where: whereClause,
        data: {
          approvalStatus: decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
          reviewedById: requesterId,
          reviewedAt: new Date(),
        },
      });

      await recalculateAccountBalances(tx, Array.from(accountIds));
      await touchLinked(tx, affected.flatMap((t) => [t.refundsId, t.repaysId]));

      return updateResult;
    }, BALANCE_TX_OPTIONS);

    res.json({ updated: result.count });
  })
);
