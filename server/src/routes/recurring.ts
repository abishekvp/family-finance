import { Router, type Request } from "express";
import { z } from "zod";
import { AccountType, Prisma, RecurringFrequency, Role, TransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { assertEncryptionPolicy, maybeEncryptedText } from "../lib/encryption";
import { formatDay, localToday, occurrence, parseDay, postingInstant } from "../lib/recurring";

// Repeating payments, nested under /api/families/:familyId/recurring.
export const recurringRouter = Router({ mergeParams: true });
recurringRouter.use(requireAuth);

const RULE_INCLUDE = {
  account: { select: { id: true, name: true, currency: true } },
  category: { select: { id: true, name: true, color: true, icon: true, type: true } },
} satisfies Prisma.RecurringTransactionInclude;

type RuleWithRelations = Prisma.RecurringTransactionGetPayload<{ include: typeof RULE_INCLUDE }>;

function serializeRule(r: RuleWithRelations) {
  return {
    id: r.id,
    familyId: r.familyId,
    userId: r.userId,
    accountId: r.accountId,
    categoryId: r.categoryId,
    type: r.type,
    amount: Number(r.amount),
    payee: r.payee,
    notes: r.notes,
    frequency: r.frequency,
    startDate: formatDay(r.startDate),
    endDate: r.endDate ? formatDay(r.endDate) : null,
    nextDate: formatDay(r.nextDate),
    postedCount: r.postedCount,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    account: r.account,
    category: r.category,
  };
}

function isVisible(ownerId: string | null, requesterId: string) {
  return ownerId === null || ownerId === requesterId;
}

async function assertRelations(familyId: string, requesterId: string, type: TransactionType, accountId: string, categoryId: string | null) {
  const account = await prisma.account.findFirst({ where: { id: accountId, familyId, isArchived: false } });
  if (!account) throw new AppError(404, "Account not found");
  if (!isVisible(account.ownerId, requesterId)) throw new AppError(403, "Cannot use another member's private account");
  if (account.type === AccountType.PERSON) throw new AppError(400, "Repeating payments go to one of your own accounts, not a person");
  if (categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, familyId, isArchived: false } });
    if (!category) throw new AppError(404, "Category not found");
    if (!isVisible(category.ownerId, requesterId)) throw new AppError(403, "Cannot use another member's private category");
    if (category.type !== type) throw new AppError(400, "Category type does not match");
  }
}

const daySchema = z.string().refine((v) => parseDay(v) !== null, { message: "Use a YYYY-MM-DD date" });
const typeSchema = z.enum([TransactionType.INCOME, TransactionType.EXPENSE]);

const createSchema = z.object({
  accountId: z.string().min(1),
  categoryId: z.string().min(1).nullable().optional(),
  type: typeSchema,
  amount: z.number().finite().gt(0),
  payee: maybeEncryptedText(200, 2048).nullable().optional(),
  notes: maybeEncryptedText(1000, 8192).nullable().optional(),
  frequency: z.nativeEnum(RecurringFrequency),
  startDate: daySchema,
  endDate: daySchema.nullable().optional(),
  // The first occurrence was just saved as this transaction (the transaction form's "Repeat").
  firstTransactionId: z.string().min(1).optional(),
});

const updateSchema = z.object({
  accountId: z.string().min(1).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  type: typeSchema.optional(),
  amount: z.number().finite().gt(0).optional(),
  payee: maybeEncryptedText(200, 2048).nullable().optional(),
  notes: maybeEncryptedText(1000, 8192).nullable().optional(),
  frequency: z.nativeEnum(RecurringFrequency).optional(),
  // Moves the schedule: the next occurrence falls on this day and later ones follow from it.
  nextDate: daySchema.optional(),
  endDate: daySchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

recurringRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const rules = await prisma.recurringTransaction.findMany({
      where: { familyId: req.params.familyId, account: { OR: [{ ownerId: null }, { ownerId: req.user!.id }] } },
      include: RULE_INCLUDE,
      orderBy: [{ isActive: "desc" }, { nextDate: "asc" }],
    });
    res.json(rules.map(serializeRule));
  })
);

recurringRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const data = createSchema.parse(req.body);
    await assertEncryptionPolicy(familyId, { payee: data.payee, notes: data.notes });
    await assertRelations(familyId, requesterId, data.type, data.accountId, data.categoryId ?? null);

    const startDate = parseDay(data.startDate)!;
    const endDate = data.endDate ? parseDay(data.endDate)! : null;
    if (endDate && endDate < startDate) throw new AppError(400, "The end date is before the first payment");

    if (data.firstTransactionId) {
      const first = await prisma.transaction.findFirst({ where: { id: data.firstTransactionId, familyId, isDeleted: false } });
      if (!first) throw new AppError(404, "Transaction not found");
      if (first.userId !== requesterId && req.familyMembership!.role !== Role.ADMIN) {
        throw new AppError(403, "Not allowed to change this transaction");
      }
    }

    const postedCount = data.firstTransactionId ? 1 : 0;
    const nextDate = occurrence(startDate, data.frequency, postedCount);
    const rule = await prisma.$transaction(async (tx) => {
      const created = await tx.recurringTransaction.create({
        data: {
          familyId,
          userId: requesterId,
          accountId: data.accountId,
          categoryId: data.categoryId ?? null,
          type: data.type,
          amount: data.amount,
          payee: data.payee ?? null,
          notes: data.notes ?? null,
          frequency: data.frequency,
          startDate,
          endDate,
          postedCount,
          nextDate,
          isActive: !(endDate && nextDate > endDate),
        },
        include: RULE_INCLUDE,
      });
      if (data.firstTransactionId) {
        await tx.transaction.update({ where: { id: data.firstTransactionId }, data: { recurringId: created.id } });
      }
      return created;
    });

    res.status(201).json(serializeRule(rule));
  })
);

async function findModifiable(req: Request) {
  const existing = await prisma.recurringTransaction.findFirst({
    where: { id: req.params.recurringId, familyId: req.params.familyId },
    include: { account: true },
  });
  if (!existing || !isVisible(existing.account.ownerId, req.user!.id)) throw new AppError(404, "Repeating payment not found");
  if (existing.userId !== req.user!.id && req.familyMembership!.role !== Role.ADMIN) {
    throw new AppError(403, "Not allowed to change this repeating payment");
  }
  return existing;
}

recurringRouter.patch(
  "/:recurringId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const existing = await findModifiable(req);
    const data = updateSchema.parse(req.body);
    await assertEncryptionPolicy(familyId, { payee: data.payee, notes: data.notes });

    const type = data.type ?? existing.type;
    const accountId = data.accountId ?? existing.accountId;
    const categoryId = "categoryId" in req.body ? data.categoryId ?? null : existing.categoryId;
    await assertRelations(familyId, req.user!.id, type, accountId, categoryId);

    const frequency = data.frequency ?? existing.frequency;
    // A new frequency or next day restarts the schedule from the next occurrence.
    const reanchor = data.frequency !== undefined || data.nextDate !== undefined;
    const startDate = reanchor ? (data.nextDate ? parseDay(data.nextDate)! : existing.nextDate) : existing.startDate;
    const postedCount = reanchor ? 0 : existing.postedCount;
    const nextDate = occurrence(startDate, frequency, postedCount);
    const endDate = "endDate" in req.body ? (data.endDate ? parseDay(data.endDate)! : null) : existing.endDate;
    const wantsActive = data.isActive ?? existing.isActive;

    const updated = await prisma.recurringTransaction.update({
      where: { id: existing.id },
      data: {
        type,
        accountId,
        categoryId,
        amount: data.amount ?? existing.amount,
        payee: "payee" in req.body ? data.payee ?? null : existing.payee,
        notes: "notes" in req.body ? data.notes ?? null : existing.notes,
        frequency,
        startDate,
        postedCount,
        nextDate,
        endDate,
        isActive: wantsActive && !(endDate && nextDate > endDate),
      },
      include: RULE_INCLUDE,
    });
    res.json(serializeRule(updated));
  })
);

recurringRouter.delete(
  "/:recurringId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const existing = await findModifiable(req);
    // Transactions already recorded stay; they just stop pointing at the schedule.
    await prisma.recurringTransaction.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

// At most this many missed occurrences are caught up per schedule in one run.
const MAX_CATCH_UP = 60;

/**
 * Records every occurrence whose day has come, dated on its own day. The apps call this when they
 * open and return to the foreground; there is no server-side scheduler. Each occurrence is claimed
 * by bumping postedCount from the value it was read at, so two devices running at once can't
 * record the same one twice.
 */
recurringRouter.post(
  "/run",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const { tzOffset } = z.object({ tzOffset: z.number().int().min(-840).max(840).default(0) }).parse(req.body ?? {});
    const today = localToday(tzOffset);

    const due = await prisma.recurringTransaction.findMany({
      where: { familyId, isActive: true, nextDate: { lte: today } },
      include: { account: { select: { isArchived: true } } },
    });

    let posted = 0;
    for (const rule of due) {
      if (rule.account.isArchived) continue;
      let count = rule.postedCount;
      for (let i = 0; i < MAX_CATCH_UP; i++) {
        const day = occurrence(rule.startDate, rule.frequency, count);
        if (day > today || (rule.endDate && day > rule.endDate)) break;
        const next = occurrence(rule.startDate, rule.frequency, count + 1);
        const claimed = await prisma.$transaction(async (tx) => {
          const claim = await tx.recurringTransaction.updateMany({
            where: { id: rule.id, postedCount: count },
            data: { postedCount: count + 1, nextDate: next, isActive: !(rule.endDate && next > rule.endDate) },
          });
          if (claim.count === 0) return false;
          await tx.transaction.create({
            data: {
              familyId,
              userId: rule.userId,
              accountId: rule.accountId,
              categoryId: rule.categoryId,
              type: rule.type,
              amount: rule.amount,
              date: postingInstant(day, tzOffset),
              payee: rule.payee,
              notes: rule.notes,
              tags: ["recurring"],
              recurringId: rule.id,
            },
          });
          return true;
        });
        // Another device got there first; it carries on from here.
        if (!claimed) break;
        count += 1;
        posted += 1;
      }
    }

    res.json({ posted });
  })
);
