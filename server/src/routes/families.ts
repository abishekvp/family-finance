import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";
import { seedDefaultCategories } from "../lib/defaultCategories";
import { accountsRouter } from "./accounts";
import { categoriesRouter } from "./categories";
import { transactionsRouter } from "./transactions";
import { budgetsRouter } from "./budgets";
import { goalsRouter } from "./goals";

export const familiesRouter = Router();

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

familiesRouter.use(requireAuth);
familiesRouter.use("/:familyId/accounts", accountsRouter);
familiesRouter.use("/:familyId/categories", categoriesRouter);
familiesRouter.use("/:familyId/transactions", transactionsRouter);
familiesRouter.use("/:familyId/budgets", budgetsRouter);
familiesRouter.use("/:familyId/goals", goalsRouter);

const createFamilySchema = z.object({
  name: z.string().trim().min(1, "Family name is required").max(100),
  currency: z.string().trim().length(3).default("USD"),
});

familiesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, currency } = createFamilySchema.parse(req.body);

    const family = await prisma.$transaction(async (tx) => {
      const created = await tx.family.create({ data: { name, currency } });
      await tx.familyMembership.create({
        data: { familyId: created.id, userId: req.user!.id, role: Role.ADMIN },
      });
      await seedDefaultCategories(tx, created.id);
      return created;
    });

    res.status(201).json(family);
  })
);

familiesRouter.get(
  "/:familyId",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const family = await prisma.family.findUniqueOrThrow({ where: { id: req.params.familyId } });
    res.json({ ...family, role: req.familyMembership!.role });
  })
);

const updateFamilySchema = z.object({
  name: z.string().trim().min(1, "Family name is required").max(100).optional(),
  currency: z.string().trim().length(3).optional(),
});

familiesRouter.patch(
  "/:familyId",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const data = updateFamilySchema.parse(req.body);

    const family = await prisma.family.update({
      where: { id: req.params.familyId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
      },
    });

    res.json({ ...family, role: req.familyMembership!.role });
  })
);

familiesRouter.get(
  "/:familyId/members",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const members = await prisma.familyMembership.findMany({
      where: { familyId: req.params.familyId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: "asc" },
    });
    res.json(
      members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        joinedAt: m.joinedAt,
      }))
    );
  })
);

const roleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

familiesRouter.patch(
  "/:familyId/members/:userId",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const role = roleSchema.parse(req.body.role);
    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: req.params.userId, familyId: req.params.familyId } },
    });
    if (!membership) throw new AppError(404, "Member not found");

    if (membership.role === Role.ADMIN && role !== Role.ADMIN) {
      const adminCount = await prisma.familyMembership.count({
        where: { familyId: req.params.familyId, role: Role.ADMIN },
      });
      if (adminCount <= 1) throw new AppError(400, "Family must have at least one admin");
    }

    const updated = await prisma.familyMembership.update({
      where: { id: membership.id },
      data: { role },
    });
    res.json(updated);
  })
);

familiesRouter.delete(
  "/:familyId/members/:userId",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: req.params.userId, familyId: req.params.familyId } },
    });
    if (!membership) throw new AppError(404, "Member not found");

    if (membership.role === Role.ADMIN) {
      const adminCount = await prisma.familyMembership.count({
        where: { familyId: req.params.familyId, role: Role.ADMIN },
      });
      if (adminCount <= 1) throw new AppError(400, "Cannot remove the last admin of a family");
    }

    await prisma.familyMembership.delete({ where: { id: membership.id } });
    res.status(204).send();
  })
);

const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: roleSchema.default("MEMBER"),
});

familiesRouter.post(
  "/:familyId/invites",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const { email, role } = createInviteSchema.parse(req.body);
    const token = crypto.randomBytes(24).toString("hex");

    const invite = await prisma.invite.create({
      data: {
        familyId: req.params.familyId,
        email,
        role,
        token,
        invitedById: req.user!.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    res.status(201).json({
      ...invite,
      // TODO: send this link via an email provider instead of returning it directly.
      inviteLink: `${req.protocol}://${req.get("host")}/invites/${invite.token}`,
    });
  })
);

familiesRouter.get(
  "/:familyId/invites",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const invites = await prisma.invite.findMany({
      where: { familyId: req.params.familyId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    res.json(invites);
  })
);

familiesRouter.delete(
  "/:familyId/invites/:inviteId",
  requireFamilyRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const invite = await prisma.invite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite || invite.familyId !== req.params.familyId) throw new AppError(404, "Invite not found");
    await prisma.invite.update({ where: { id: invite.id }, data: { status: "REVOKED" } });
    res.status(204).send();
  })
);

export const invitesRouter = Router();
invitesRouter.use(requireAuth);

invitesRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const invite = await prisma.invite.findUnique({
      where: { token: req.params.token },
      include: { family: { select: { id: true, name: true } } },
    });
    if (!invite) throw new AppError(404, "Invite not found");
    res.json({
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      family: invite.family,
    });
  })
);

invitesRouter.post(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const invite = await prisma.invite.findUnique({ where: { token: req.params.token } });
    if (!invite) throw new AppError(404, "Invite not found");
    if (invite.status !== "PENDING") throw new AppError(400, "This invite is no longer valid");
    if (invite.expiresAt < new Date()) {
      await prisma.invite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
      throw new AppError(400, "This invite has expired");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new AppError(403, "This invite was sent to a different email address");
    }

    const family = await prisma.$transaction(async (tx) => {
      await tx.familyMembership.upsert({
        where: { userId_familyId: { userId: user.id, familyId: invite.familyId } },
        create: { userId: user.id, familyId: invite.familyId, role: invite.role },
        update: {},
      });
      await tx.invite.update({ where: { id: invite.id }, data: { status: "ACCEPTED" } });
      return tx.family.findUniqueOrThrow({ where: { id: invite.familyId } });
    });

    res.json(family);
  })
);
