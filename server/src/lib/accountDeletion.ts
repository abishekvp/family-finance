import { Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";
import { NOT_COUNTED_TAG } from "./tags";

type Tx = Prisma.TransactionClient;

/**
 * Deletes a family and everything in it. Children go first, in an order that satisfies the RESTRICT
 * foreign keys between them (a transaction's account, a budget's category), rather than relying on
 * the order Postgres happens to cascade in.
 */
async function deleteFamily(tx: Tx, familyId: string) {
  await tx.transaction.deleteMany({ where: { familyId } });
  await tx.recurringTransaction.deleteMany({ where: { familyId } });
  await tx.budget.deleteMany({ where: { familyId } });
  await tx.goal.deleteMany({ where: { familyId } });
  // Accounts, categories, payee rules, invites, keys and memberships cascade from the family.
  await tx.family.delete({ where: { id: familyId } });
}

/**
 * Takes a member out of a family that carries on without them. What was theirs alone goes; what the
 * family shares stays exactly as it was, so shared balances and history don't change under the others.
 */
async function leaveFamily(tx: Tx, familyId: string, userId: string, successorId: string) {
  const now = new Date();
  const personal = await tx.account.findMany({ where: { familyId, ownerId: userId }, select: { id: true } });
  const personalIds = personal.map((a) => a.id);

  if (personalIds.length > 0) {
    // Money that moved between one of their personal accounts (or a personal lend & borrow tab) and a
    // family account really moved the family account's balance. That side stays, as an income or an
    // expense that isn't counted — it was never income or spending, just money changing hands.
    await tx.$executeRaw`
      UPDATE "Transaction"
      SET "type" = 'INCOME', "accountId" = "transferToAccountId", "transferToAccountId" = NULL, "categoryId" = NULL,
          "repaysId" = NULL, "dueDate" = NULL, "tags" = array_append(array_remove("tags", ${NOT_COUNTED_TAG}), ${NOT_COUNTED_TAG}),
          "updatedAt" = ${now}
      WHERE "familyId" = ${familyId} AND "type" = 'TRANSFER' AND "accountId" = ANY(${personalIds})
        AND "transferToAccountId" IS NOT NULL AND NOT ("transferToAccountId" = ANY(${personalIds}))`;
    await tx.$executeRaw`
      UPDATE "Transaction"
      SET "type" = 'EXPENSE', "transferToAccountId" = NULL, "categoryId" = NULL,
          "repaysId" = NULL, "dueDate" = NULL, "tags" = array_append(array_remove("tags", ${NOT_COUNTED_TAG}), ${NOT_COUNTED_TAG}),
          "updatedAt" = ${now}
      WHERE "familyId" = ${familyId} AND "type" = 'TRANSFER' AND "transferToAccountId" = ANY(${personalIds})
        AND NOT ("accountId" = ANY(${personalIds}))`;
    // Everything else on their personal accounts goes with them.
    await tx.transaction.deleteMany({
      where: { familyId, OR: [{ accountId: { in: personalIds } }, { transferToAccountId: { in: personalIds } }] },
    });
    await tx.recurringTransaction.deleteMany({ where: { familyId, accountId: { in: personalIds } } });
    // Account.ownerId is SET NULL: deleted rather than left to turn into family accounts.
    await tx.account.deleteMany({ where: { id: { in: personalIds } } });
  }

  // Their repeating payments stop: nobody's salary should keep arriving after they've gone.
  await tx.recurringTransaction.deleteMany({ where: { familyId, userId } });
  // Entries they recorded on family accounts stay with the family, under whoever now runs it.
  await tx.transaction.updateMany({ where: { familyId, userId }, data: { userId: successorId, updatedAt: now } });
  await tx.goalContribution.updateMany({ where: { userId, goal: { familyId } }, data: { userId: successorId } });

  // Budget/Category.ownerId are SET NULL too: personal ones are removed explicitly, never shared.
  await tx.budget.deleteMany({ where: { familyId, ownerId: userId } });
  await tx.goal.deleteMany({ where: { familyId, ownerId: userId } });
  const categories = await tx.category.findMany({ where: { familyId, ownerId: userId }, select: { id: true } });
  if (categories.length > 0) {
    const ids = categories.map((c) => c.id);
    // A personal category still filing family entries becomes a family one, so those keep their category.
    const used = await tx.transaction.findMany({
      where: { familyId, categoryId: { in: ids } },
      distinct: ["categoryId"],
      select: { categoryId: true },
    });
    const usedIds = used.map((t) => t.categoryId!).filter(Boolean);
    if (usedIds.length > 0) await tx.category.updateMany({ where: { id: { in: usedIds } }, data: { ownerId: null } });
    await tx.category.deleteMany({ where: { id: { in: ids.filter((id) => !usedIds.includes(id)) } } });
  }

  await tx.familyKey.deleteMany({ where: { familyId, userId } });
  await tx.familyMembership.deleteMany({ where: { familyId, userId } });
}

/** Every family the user has data in: the ones they belong to, and any they were removed from since. */
async function familiesWithData(userId: string) {
  const byFamily = { distinct: "familyId" as const, select: { familyId: true as const } };
  const found = await Promise.all([
    prisma.familyMembership.findMany({ where: { userId }, ...byFamily }),
    prisma.account.findMany({ where: { ownerId: userId }, ...byFamily }),
    prisma.transaction.findMany({ where: { userId }, ...byFamily }),
    prisma.recurringTransaction.findMany({ where: { userId }, ...byFamily }),
    prisma.category.findMany({ where: { ownerId: userId }, ...byFamily }),
    prisma.budget.findMany({ where: { ownerId: userId }, ...byFamily }),
    prisma.goal.findMany({ where: { ownerId: userId }, ...byFamily }),
  ]);
  const familyIds = Array.from(new Set(found.flat().map((r) => r.familyId)));
  return prisma.family.findMany({
    where: { id: { in: familyIds } },
    select: { id: true, memberships: { select: { userId: true, role: true, joinedAt: true } } },
  });
}

/**
 * Permanently deletes a user and their data. A family they were the only member of is deleted with
 * them; a family others share keeps everything shared, with the longest-standing remaining member made
 * admin if no other admin is left.
 */
export async function deleteUserAccount(userId: string) {
  const families = await familiesWithData(userId);

  await prisma.$transaction(
    async (tx) => {
      for (const family of families) {
        const others = family.memberships
          .filter((m) => m.userId !== userId)
          .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
        if (others.length === 0) {
          await deleteFamily(tx, family.id);
          continue;
        }
        let successor = others.find((m) => m.role === Role.ADMIN);
        if (!successor) {
          successor = others[0];
          await tx.familyMembership.update({
            where: { userId_familyId: { userId: successor.userId, familyId: family.id } },
            data: { role: Role.ADMIN },
          });
        }
        await leaveFamily(tx, family.id, userId, successor.userId);
      }

      // RESTRICT references that can outlive a family membership.
      await tx.invite.deleteMany({ where: { invitedById: userId } });
      await tx.goalContribution.deleteMany({ where: { userId } });
      await tx.auditLog.deleteMany({ where: { actorId: userId } });
      // Sessions, passkeys, sign-in links, the vault and codes cascade from the user.
      await tx.user.delete({ where: { id: userId } });
    },
    { maxWait: 10_000, timeout: 60_000 }
  );
}
