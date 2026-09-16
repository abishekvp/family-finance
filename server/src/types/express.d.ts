import type { FamilyMembership } from "@prisma/client";

export interface AuthUser {
  id: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      familyMembership?: FamilyMembership;
    }
  }
}

export {};
