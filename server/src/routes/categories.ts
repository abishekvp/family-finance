import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../middleware/errorHandler";
import { requireAuth, requireFamilyRole } from "../middleware/auth";

export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth);

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
