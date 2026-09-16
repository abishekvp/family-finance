import { Router } from "express";
import { z } from "zod";
import { CategoryType, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";

export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth);

function isVisible(ownerId: string | null, requesterId: string) {
  return ownerId === null || ownerId === requesterId;
}

function assertCanModify(ownerId: string | null, requesterId: string, role: Role) {
  if (ownerId === null) {
    if (role !== Role.ADMIN) {
      throw new AppError(403, "Only an admin can modify a shared category");
    }
  } else if (ownerId !== requesterId) {
    throw new AppError(403, "Not allowed to modify this category");
  }
}

categoriesRouter.get(
  "/",
  requireFamilyRole(Role.VIEWER),
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: {
        familyId: req.params.familyId,
        isArchived: false,
        OR: [{ ownerId: null }, { ownerId: req.user!.id }],
      },
      orderBy: [{ sortOrder: "asc" }],
    });
    res.json(categories);
  })
);

const categoryTypeSchema = z.nativeEnum(CategoryType);

const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: categoryTypeSchema,
  color: z.string().trim().optional(),
  icon: z.string().trim().optional(),
  parentId: z.string().min(1).nullable().optional(),
  isCommon: z.boolean().default(true),
});

categoriesRouter.post(
  "/",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;
    const data = createCategorySchema.parse(req.body);

    if (data.parentId) {
      const parent = await prisma.category.findFirst({
        where: { id: data.parentId, familyId, isArchived: false },
      });
      if (!parent) throw new AppError(404, "Parent category not found");
      if (!isVisible(parent.ownerId, requesterId)) {
        throw new AppError(403, "Cannot use another member's private category as a parent");
      }
      if (parent.type !== data.type) {
        throw new AppError(400, "Parent category type does not match");
      }
    }

    const category = await prisma.category.create({
      data: {
        familyId,
        ownerId: data.isCommon ? null : requesterId,
        name: data.name,
        type: data.type,
        parentId: data.parentId ?? null,
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
      },
    });

    res.status(201).json(category);
  })
);

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: z.string().trim().optional(),
  icon: z.string().trim().optional(),
  parentId: z.string().min(1).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

categoriesRouter.patch(
  "/:categoryId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.category.findFirst({
      where: { id: req.params.categoryId, familyId, isArchived: false },
    });
    if (!existing) throw new AppError(404, "Category not found");

    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    const data = updateCategorySchema.parse(req.body);

    if (data.parentId) {
      if (data.parentId === existing.id) {
        throw new AppError(400, "A category cannot be its own parent");
      }
      const parent = await prisma.category.findFirst({
        where: { id: data.parentId, familyId, isArchived: false },
      });
      if (!parent) throw new AppError(404, "Parent category not found");
      if (!isVisible(parent.ownerId, requesterId)) {
        throw new AppError(403, "Cannot use another member's private category as a parent");
      }
      if (parent.type !== existing.type) {
        throw new AppError(400, "Parent category type does not match");
      }
    }

    const updated = await prisma.category.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...("parentId" in req.body ? { parentId: data.parentId ?? null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });

    res.json(updated);
  })
);

categoriesRouter.delete(
  "/:categoryId",
  requireFamilyRole(Role.MEMBER),
  asyncHandler(async (req, res) => {
    const familyId = req.params.familyId;
    const requesterId = req.user!.id;

    const existing = await prisma.category.findFirst({
      where: { id: req.params.categoryId, familyId, isArchived: false },
    });
    if (!existing) throw new AppError(404, "Category not found");

    assertCanModify(existing.ownerId, requesterId, req.familyMembership!.role);

    await prisma.$transaction([
      prisma.category.update({ where: { id: existing.id }, data: { isArchived: true } }),
      prisma.category.updateMany({
        where: { familyId, parentId: existing.id },
        data: { isArchived: true },
      }),
    ]);

    res.status(204).send();
  })
);
