import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../lib/jwt";
import { AppError } from "./errorHandler";
import { prisma } from "../lib/prisma";
import { Role } from "@prisma/client";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next(new AppError(401, "Missing or invalid Authorization header"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: "" };
    next();
  } catch {
    next(new AppError(401, "Invalid or expired access token"));
  }
}

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
};

export function requireFamilyRole(minRole: Role) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const familyId = req.params.familyId ?? req.body.familyId;
    if (!familyId) return next(new AppError(400, "familyId is required"));
    if (!req.user) return next(new AppError(401, "Not authenticated"));

    const membership = await prisma.familyMembership.findUnique({
      where: { userId_familyId: { userId: req.user.id, familyId } },
    });

    if (!membership) return next(new AppError(403, "Not a member of this family"));
    if (ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      return next(new AppError(403, "Insufficient role for this action"));
    }

    req.familyMembership = membership;
    next();
  };
}
