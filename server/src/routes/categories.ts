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
  // true = shared with the family, false = private to the requester.
  isCommon: z.boolean().optional(),
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

    const wasCommon = existing.ownerId === null;
    const becomesCommon = data.isCommon !== undefined && data.isCommon !== wasCommon ? data.isCommon : null;
    const nextParentId = "parentId" in req.body ? data.parentId ?? null : existing.parentId;

    const parentChanges = "parentId" in req.body && nextParentId !== existing.parentId;
    if ((becomesCommon ?? wasCommon) && nextParentId && (becomesCommon === true || parentChanges)) {
      // Everyone would see a subcategory whose parent only one member can see.
      const parent = await prisma.category.findUnique({ where: { id: nextParentId } });
      if (parent?.ownerId) {
        throw new AppError(400, "Its parent category is personal — share the parent with the family first");
      }
    }

    // Going private takes the category's shared subcategories with it, so no one is left with a
    // shared child under a parent they can no longer see.
    let privatizedIds: string[] = [];
    if (becomesCommon === false) {
      const sharedChildren = await prisma.category.findMany({
        where: { familyId, parentId: existing.id, ownerId: null, isArchived: false },
        select: { id: true },
      });
      privatizedIds = [existing.id, ...sharedChildren.map((c) => c.id)];

      // Other members' transactions, budgets and personal subcategories would point at a category
      // they can no longer see or pick.
      const [othersTransactions, othersBudgets, othersChildren] = await Promise.all([
        prisma.transaction.count({
          where: { familyId, categoryId: { in: privatizedIds }, isDeleted: false, userId: { not: requesterId } },
        }),
        prisma.budget.count({
          where: { familyId, categoryId: { in: privatizedIds }, OR: [{ ownerId: null }, { ownerId: { not: requesterId } }] },
        }),
        prisma.category.count({
          where: {
            familyId,
            parentId: existing.id,
            isArchived: false,
            AND: [{ ownerId: { not: null } }, { ownerId: { not: requesterId } }],
          },
        }),
      ]);
      if (othersTransactions > 0 || othersBudgets > 0 || othersChildren > 0) {
        const uses = [
          othersTransactions > 0 ? `${othersTransactions} transaction${othersTransactions === 1 ? "" : "s"}` : null,
          othersBudgets > 0 ? `${othersBudgets} shared budget${othersBudgets === 1 ? "" : "s"}` : null,
          othersChildren > 0 ? `${othersChildren} personal subcategor${othersChildren === 1 ? "y" : "ies"}` : null,
        ]
          .filter(Boolean)
          .join(" and ");
        throw new AppError(409, `It can't be made personal: other family members use it in ${uses}.`);
      }
    }

    const updateCategory = prisma.category.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.color !== undefined ? { color: data.color } : {}),
        ...(data.icon !== undefined ? { icon: data.icon } : {}),
        ...("parentId" in req.body ? { parentId: data.parentId ?? null } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(becomesCommon !== null ? { ownerId: becomesCommon ? null : requesterId } : {}),
      },
    });
    const childIds = privatizedIds.filter((id) => id !== existing.id);
    // Batch, not interactive: see the P2028 note in lib/defaultCategories.ts.
    const [updated] = childIds.length
      ? await prisma.$transaction([
          updateCategory,
          prisma.category.updateMany({ where: { id: { in: childIds } }, data: { ownerId: requesterId } }),
        ])
      : [await updateCategory];

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
