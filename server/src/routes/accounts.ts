import { Router } from "express";
import { z } from "zod";
import { AccountType, Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { BALANCE_TX_OPTIONS, lockAccounts, recalculateAccountBalances, recalculateBalancesNow } from "../lib/balances";
import { checkEncryptionPolicy, isEncryptedValue, maybeEncryptedText } from "../lib/encryption";

export const accountsRouter = Router({ mergeParams: true });
accountsRouter.use(requireAuth);

const VISIBLE_TO = (userId: string): Prisma.AccountWhereInput => ({ OR: [{ ownerId: null }, { ownerId: userId }] });

function isVisible(ownerId: string | null, requesterId: string) {
  return ownerId === null || ownerId === requesterId;
}

// Accounts are nested under /api/families/:familyId/accounts
accountsRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const accounts = await prisma.account.findMany({
      where: {
        familyId: req.params.familyId,
        isArchived: false,
        ...VISIBLE_TO(req.user!.id),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: { owner: { select: { id: true, name: true } } },
    });

    const withBalances = accounts.map((account) => ({
      ...account,
      balance: Number(account.currentBalance),
    }));

    res.json(withBalances);
  })
);

/**
 * Each visible account's balance as it stood just before `asOf`: its opening balance plus every
 * approved entry dated earlier. What the carry-over rows need — one small aggregate instead of
 * downloading every earlier transaction to add them up on the device.
 */
accountsRouter.get(
  "/balances",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const asOf = typeof req.query.asOf === "string" ? new Date(req.query.asOf) : null;
    if (!asOf || Number.isNaN(asOf.getTime())) throw new AppError(400, "asOf must be a date");
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const rows = await prisma.$queryRaw<{ id: string; balance: Prisma.Decimal }[]>`
      SELECT a.id,
        a."openingBalance"
        + COALESCE((
            SELECT SUM(CASE WHEN t."type" = 'INCOME' THEN t."amount" ELSE -t."amount" END)
            FROM "Transaction" t
            WHERE t."accountId" = a.id AND t."isDeleted" = false AND t."approvalStatus" = 'APPROVED' AND t."date" < ${asOf}
          ), 0)
        + COALESCE((
            SELECT SUM(t."amount")
            FROM "Transaction" t
            WHERE t."transferToAccountId" = a.id AND t."type" = 'TRANSFER' AND t."isDeleted" = false
              AND t."approvalStatus" = 'APPROVED' AND t."date" < ${asOf}
          ), 0) AS balance
      FROM "Account" a
      WHERE a."familyId" = ${familyId} AND a."isArchived" = false AND (a."ownerId" IS NULL OR a."ownerId" = ${requesterId})`;

    res.json(Object.fromEntries(rows.map((r) => [r.id, Number(r.balance)])));
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
        // Nothing has been recorded on it yet, so it starts at its opening balance.
        currentBalance: data.openingBalance,
      },
    });

    res.status(201).json({ ...account, balance: Number(account.currentBalance) });
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
    // Entries with a person are lend & borrow; with an account they're transfers. Switching between
    // the two would silently change what every one of them means.
    if (data.type !== undefined && (data.type === AccountType.PERSON) !== (existing.type === AccountType.PERSON)) {
      throw new AppError(400, existing.type === AccountType.PERSON ? "A person can't become an account" : "An account can't become a person");
    }

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

    // The balance is the opening balance plus everything recorded since, so it moves with it.
    if (data.openingBalance !== undefined && Number(existing.openingBalance) !== data.openingBalance) {
      await recalculateBalancesNow([existing.id]);
    }

    // Client refetches the account list (which reads the balance) after a save,
    // so the raw updated row is returned here.
    res.json(updated);
  })
);

/** The person's name, kept on each entry moved off them, e.g. "Ravi · dinner at the beach". */
function withNameInNotes(name: string, notes: string | null) {
  const trimmed = notes?.trim() ?? "";
  if (trimmed === name || trimmed.startsWith(`${name} · `)) return trimmed;
  return (trimmed ? `${name} · ${trimmed}` : name).slice(0, 1000);
}

const mergeSchema = z
  .object({
    // Another person to move them into…
    targetId: z.string().min(1).optional(),
    // …or a new one made for it, e.g. a "Friends" group.
    newTarget: z.object({ name: z.string().trim().min(1).max(100), isCommon: z.boolean().default(false) }).optional(),
    // For a family with end-to-end encryption the server can't write the name into encrypted notes, so
    // the device sends each entry's new notes, already sealed.
    notes: z
      .array(z.object({ id: z.string().min(1), notes: maybeEncryptedText(1000, 8192).nullable() }))
      .max(10_000)
      .optional(),
  })
  .refine((d) => !!d.targetId !== !!d.newTarget, { message: "Choose who to move their entries to" });

/**
 * Deletes a person and moves everything recorded with them — loans, returns, write-offs, what they
 * paid for — onto another person or a group like "Friends". Each moved entry keeps the person's name
 * in its notes, their opening balance moves too, and the balances add up exactly as before.
 */
accountsRouter.post(
  "/:accountId/merge",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const data = mergeSchema.parse(req.body);

    const [source, family] = await Promise.all([
      prisma.account.findFirst({ where: { id: req.params.accountId, familyId, isArchived: false } }),
      prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { encryptionEnabled: true } }),
    ]);
    if (!source || source.type !== AccountType.PERSON || !isVisible(source.ownerId, requesterId)) {
      throw new AppError(404, "Person not found");
    }
    assertCanModify(source.ownerId, requesterId, req.familyMembership!.role);
    for (const n of data.notes ?? []) checkEncryptionPolicy(family.encryptionEnabled, { notes: n.notes });

    let target = data.targetId
      ? await prisma.account.findFirst({ where: { id: data.targetId, familyId, isArchived: false, type: AccountType.PERSON } })
      : null;
    if (data.targetId) {
      if (!target || !isVisible(target.ownerId, requesterId)) throw new AppError(404, "The person to move them to was not found");
      if (target.id === source.id) throw new AppError(400, "Choose someone else to move their entries to");
      // Family entries moved onto a personal tab would vanish for everyone else.
      if (source.ownerId === null && target.ownerId !== null) {
        throw new AppError(400, `${source.name} is shared with the family, so their entries can only move to someone shared too`);
      }
    }

    const merged = await prisma.$transaction(async (tx) => {
      if (!target) {
        target = await tx.account.create({
          data: {
            familyId,
            // Moving a shared person's entries keeps them shared.
            ownerId: source.ownerId === null || data.newTarget!.isCommon ? null : requesterId,
            name: data.newTarget!.name,
            type: AccountType.PERSON,
            currency: source.currency,
          },
        });
      }
      const into = target;
      await lockAccounts(tx, [source.id, into.id]);

      // Everything with them, the bin included, so a restored entry lands in the right place too.
      const moving = await tx.transaction.findMany({
        where: { familyId, OR: [{ accountId: source.id }, { transferToAccountId: source.id }] },
        select: { id: true, notes: true },
      });
      const sealedNotes = new Map((data.notes ?? []).map((n) => [n.id, n.notes]));
      const notes: { id: string; notes: string | null }[] = [];
      for (const t of moving) {
        if (sealedNotes.has(t.id)) notes.push({ id: t.id, notes: sealedNotes.get(t.id)! });
        // Ciphertext the device didn't rewrite (it can't see entries in the bin) stays as it was.
        else if (!isEncryptedValue(t.notes)) notes.push({ id: t.id, notes: withNameInNotes(source.name, t.notes) });
      }

      const now = new Date();
      if (notes.length > 0) {
        await tx.$executeRaw`
          UPDATE "Transaction" AS t SET "notes" = v.notes
          FROM unnest(${notes.map((n) => n.id)}::text[], ${notes.map((n) => n.notes)}::text[]) AS v(id, notes)
          WHERE t.id = v.id AND t."familyId" = ${familyId}`;
      }
      await tx.transaction.updateMany({ where: { familyId, accountId: source.id }, data: { accountId: into.id, updatedAt: now } });
      await tx.transaction.updateMany({ where: { familyId, transferToAccountId: source.id }, data: { transferToAccountId: into.id, updatedAt: now } });
      // An entry between the two of them now runs from the group to itself and moves nothing.
      await tx.transaction.updateMany({
        where: { familyId, accountId: into.id, transferToAccountId: into.id, isDeleted: false },
        data: { isDeleted: true, deletedAt: now },
      });
      await tx.goal.updateMany({ where: { familyId, accountId: source.id }, data: { accountId: into.id } });
      await tx.recurringTransaction.updateMany({ where: { familyId, accountId: source.id }, data: { accountId: into.id } });

      // What they owed (or were owed) from before the app moves with them.
      await tx.account.update({
        where: { id: into.id },
        data: { openingBalance: { increment: source.openingBalance } },
      });
      await tx.account.delete({ where: { id: source.id } });
      await recalculateAccountBalances(tx, [into.id]);
      return tx.account.findUniqueOrThrow({ where: { id: into.id }, include: { owner: { select: { id: true, name: true } } } });
    }, BALANCE_TX_OPTIONS);

    res.json({ ...merged, balance: Number(merged.currentBalance) });
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

    if (existing.type === AccountType.PERSON) {
      const onPerson: Prisma.TransactionWhereInput = { familyId, OR: [{ accountId: existing.id }, { transferToAccountId: existing.id }] };
      const recorded = await prisma.transaction.count({ where: onPerson });

      // Nobody ever recorded anything with them: they can simply go.
      if (recorded === 0) {
        await prisma.$transaction([
          prisma.goal.updateMany({ where: { familyId, accountId: existing.id }, data: { accountId: null } }),
          prisma.account.delete({ where: { id: existing.id } }),
        ]);
        res.status(204).send();
        return;
      }

      // Deleted with their entries: those go to the bin (restoring one brings the person back) and the
      // balances of your accounts change back as if they never happened.
      if (req.query.entries === "delete") {
        await prisma.$transaction(async (tx) => {
          const live = await tx.transaction.findMany({
            where: { ...onPerson, isDeleted: false },
            select: { accountId: true, transferToAccountId: true },
          });
          const touched = [existing.id, ...live.flatMap((t) => [t.accountId, t.transferToAccountId])];
          await lockAccounts(tx, touched);
          await tx.transaction.updateMany({ where: { ...onPerson, isDeleted: false }, data: { isDeleted: true, deletedAt: new Date() } });
          await tx.account.update({ where: { id: existing.id }, data: { isArchived: true } });
          await recalculateAccountBalances(tx, touched);
        }, BALANCE_TX_OPTIONS);
        res.status(204).send();
        return;
      }
    }

    // Archived: hidden from lists, while entries already recorded on it stay where they are.
    await prisma.account.update({
      where: { id: existing.id },
      data: { isArchived: true },
    });

    res.status(204).send();
  })
);
