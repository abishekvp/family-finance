import type { Response } from "express";
import type { User } from "@prisma/client";
import { prisma } from "./prisma";
import { generateRefreshToken, REFRESH_TOKEN_TTL_MS, signAccessToken, successorRefreshToken } from "./jwt";

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

/**
 * Swaps a refresh token for its successor in one transaction: the old one is revoked and the new
 * one exists together or not at all. Returns null when the old token was no longer live (another
 * request rotated it first) — the caller then looks for the successor that request created.
 */
export async function rotateSession(res: Response, tokenId: string, userId: string, oldToken: string) {
  const { token, tokenHash, expiresAt } = successorRefreshToken(oldToken);
  const rotated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.refreshToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) return false;
    await tx.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
    return true;
  });
  if (!rotated) return null;
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
  return { accessToken: signAccessToken(userId), refreshToken: token };
}

/**
 * For a token that was already rotated: its successor, if that is still live and has never been
 * used itself. That is exactly the state a client is in when it never received the rotation's
 * response, so it gets the same successor back (with a fresh access token) instead of a 401.
 */
export async function replaySession(res: Response, oldToken: string) {
  const { token, tokenHash } = successorRefreshToken(oldToken);
  const successor = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!successor || successor.revokedAt || successor.expiresAt < new Date()) return null;
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
  return { accessToken: signAccessToken(successor.userId), refreshToken: token };
}

export async function revokeAllSessions(userId: string) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
