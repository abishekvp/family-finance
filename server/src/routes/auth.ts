import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import {
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from "../lib/jwt";

export const authRouter = Router();

const REFRESH_COOKIE = "refreshToken";
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_TTL_MS,
};

function sanitizeUser(user: { id: string; email: string; name: string; avatarUrl: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
  };
}

async function issueSession(res: import("express").Response, userId: string) {
  const accessToken = signAccessToken(userId);
  const { token, tokenHash, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { userId, tokenHash, expiresAt } });
  // Web clients get the refresh token as an httpOnly cookie. Native clients have no cookie
  // jar, so it's also returned in the body for them to store in device-secure storage.
  res.cookie(REFRESH_COOKIE, token, REFRESH_COOKIE_OPTIONS);
  return { accessToken, refreshToken: token };
}

const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { name, email, passwordHash } });

    const { accessToken, refreshToken } = await issueSession(res, user.id);
    res.status(201).json({ accessToken, refreshToken, user: sanitizeUser(user) });
  })
);

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      throw new AppError(401, "Invalid email or password");
    }

    const { accessToken, refreshToken } = await issueSession(res, user.id);
    res.json({ accessToken, refreshToken, user: sanitizeUser(user) });
  })
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (!token) throw new AppError(401, "Missing refresh token");

    const tokenHash = hashRefreshToken(token);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
      throw new AppError(401, "Refresh token is invalid or expired");
    }

    await prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const { accessToken, refreshToken } = await issueSession(res, existing.userId);
    res.json({ accessToken, refreshToken });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    if (token) {
      const tokenHash = hashRefreshToken(token);
      await prisma.refreshToken
        .updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
    }
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    res.status(204).send();
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        memberships: {
          include: { family: { select: { id: true, name: true, currency: true } } },
        },
      },
    });
    if (!user) throw new AppError(404, "User not found");

    res.json({
      ...sanitizeUser(user),
      families: user.memberships.map((m) => ({
        id: m.family.id,
        name: m.family.name,
        currency: m.family.currency,
        role: m.role,
      })),
    });
  })
);
