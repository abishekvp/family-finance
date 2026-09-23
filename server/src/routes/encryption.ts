import { Router } from "express";
import { z } from "zod";
import { Prisma, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireFamilyRole } from "../middleware/auth";
import { ENCRYPTED_PREFIX, maybeEncryptedText } from "../lib/encryption";

// Family-level end-to-end encryption. A random family data key is generated on a member's device,
// sealed to each member's vault public key, and stored here only in that sealed form. Any member
// holding the key can seal it for members who set up a vault later (see /grant).

export const encryptionRouter = Router({ mergeParams: true });

const wrappedKeysSchema = z
  .array(z.object({ userId: z.string().min(1), wrappedKey: z.string().min(1).max(1024) }))
  .max(200);

encryptionRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const [family, memberships, keys] = await Promise.all([
      prisma.family.findUniqueOrThrow({ where: { id: familyId }, select: { encryptionEnabled: true } }),
      prisma.familyMembership.findMany({
        where: { familyId },
        include: { user: { select: { id: true, name: true, vault: { select: { publicKey: true } } } } },
      }),
      prisma.familyKey.findMany({ where: { familyId }, select: { userId: true, wrappedKey: true } }),
    ]);
    const keyByUser = new Map(keys.map((k) => [k.userId, k.wrappedKey]));

    res.json({
      enabled: family.encryptionEnabled,
      wrappedKey: keyByUser.get(req.user!.id) ?? null,
      members: memberships.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        publicKey: m.user.vault?.publicKey ?? null,
        hasKey: keyByUser.has(m.user.id),
      })),
    });
  })
);

async function assertMembersWithVaults(familyId: string, entries: { userId: string }[]) {
  const ids = entries.map((e) => e.userId);
  const valid = await prisma.familyMembership.count({
    where: { familyId, userId: { in: ids }, user: { vault: { isNot: null } } },
  });
  if (valid !== new Set(ids).size) throw new AppError(400, "Keys can only be shared with family members who have a vault");
}

encryptionRouter.post(
  "/enable",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const { wrappedKeys } = z.object({ wrappedKeys: wrappedKeysSchema }).parse(req.body);
    if (!wrappedKeys.some((k) => k.userId === req.user!.id)) {
      throw new AppError(400, "Your own key must be included");
    }
    await assertMembersWithVaults(familyId, wrappedKeys);

    await prisma.$transaction(async (tx) => {
      const family = await tx.family.findUniqueOrThrow({ where: { id: familyId } });
      if (family.encryptionEnabled) throw new AppError(409, "Encryption is already enabled");
      await tx.familyKey.deleteMany({ where: { familyId } });
      await tx.familyKey.createMany({ data: wrappedKeys.map((k) => ({ familyId, ...k })) });
      await tx.family.update({ where: { id: familyId }, data: { encryptionEnabled: true } });
    });
    res.json({ ok: true });
  })
);

// Called automatically by any unlocked member's client for members who don't have the key yet.
encryptionRouter.post(
  "/grant",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const { wrappedKeys } = z.object({ wrappedKeys: wrappedKeysSchema }).parse(req.body);
    const own = await prisma.familyKey.findUnique({ where: { familyId_userId: { familyId, userId: req.user!.id } } });
    if (!own) throw new AppError(403, "You don't hold this family's key");
    await assertMembersWithVaults(familyId, wrappedKeys);
    await prisma.familyKey.createMany({ data: wrappedKeys.map((k) => ({ familyId, ...k })), skipDuplicates: true });
    res.json({ ok: true });
  })
);

// Transactions whose payee/notes still need converting (plaintext → ciphertext after enabling,
// ciphertext → plaintext before disabling). The admin's client works through these in batches.
encryptionRouter.get(
  "/pending",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const direction = req.query.direction === "decrypt" ? "decrypt" : "encrypt";

    const needs = (field: "payee" | "notes"): Prisma.TransactionWhereInput =>
      direction === "decrypt"
        ? { [field]: { startsWith: ENCRYPTED_PREFIX } }
        : { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }, { NOT: { [field]: { startsWith: ENCRYPTED_PREFIX } } }] };

    const [items, remaining] = await Promise.all([
      prisma.transaction.findMany({
        where: { familyId, OR: [needs("payee"), needs("notes")] },
        select: { id: true, payee: true, notes: true },
        take: 200,
      }),
      prisma.transaction.count({ where: { familyId, OR: [needs("payee"), needs("notes")] } }),
    ]);
    res.json({ items, remaining });
  })
);

encryptionRouter.post(
  "/bulk",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const { items } = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string().min(1),
              payee: maybeEncryptedText(200, 2048).nullable(),
              notes: maybeEncryptedText(1000, 8192).nullable(),
            })
          )
          .max(200),
      })
      .parse(req.body);

    await prisma.$transaction(
      items.map((item) =>
        prisma.transaction.updateMany({
          where: { id: item.id, familyId },
          data: { payee: item.payee, notes: item.notes },
        })
      )
    );
    res.json({ updated: items.length });
  })
);

encryptionRouter.post(
  "/disable",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const stillEncrypted = await prisma.transaction.count({
      where: {
        familyId,
        OR: [{ payee: { startsWith: ENCRYPTED_PREFIX } }, { notes: { startsWith: ENCRYPTED_PREFIX } }],
      },
    });
    if (stillEncrypted > 0) {
      throw new AppError(409, `${stillEncrypted} transactions are still encrypted — decrypt them first`);
    }
    await prisma.$transaction([
      prisma.family.update({ where: { id: familyId }, data: { encryptionEnabled: false } }),
      prisma.familyKey.deleteMany({ where: { familyId } }),
    ]);
    res.json({ ok: true });
  })
);
