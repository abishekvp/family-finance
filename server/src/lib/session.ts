import type { Response } from "express";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { generateRefreshToken, REFRESH_TOKEN_TTL_MS, signAccessToken } from "./jwt";

export const REFRESH_COOKIE = "refreshToken";
export const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_TTL_MS,
};

export function sanitizeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
    hasPassword: user.passwordHash !== null,
    createdAt: user.createdAt,
  };
}

export function displayName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

export async function issueSession(res: Response, userId: string) {
  const accessToken = signAccessToken(userId);
  const { token, tokenHash, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  // Web clients get the refresh token as an httpOnly cookie. Native clients have no cookie
  // jar, so it's also returned in the body for them to store in device-secure storage.
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
  return { accessToken, refreshToken: token };
}

export async function revokeAllSessions(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
