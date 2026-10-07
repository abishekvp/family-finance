import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma, VerificationPurpose } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { requireAuth } from "../middleware/auth";
import { hashRefreshToken, signPurposeToken, verifyPurposeToken } from "../lib/jwt";
import {
  displayName,
  issueSession,
  REFRESH_COOKIE,
  replaySession,
  revokeAllSessions,
  rotateSession,
  sanitizeUser,
} from "../lib/session";
import { consumeCode, createCode } from "../lib/otp";
import { sendCodeEmail, sendMail } from "../lib/mailer";
import { deleteUserAccount } from "../lib/accountDeletion";
import { oauthRouter } from "./oauth";
import { passkeysRouter } from "./passkeys";

export const authRouter = Router();

authRouter.use("/oauth", oauthRouter);
authRouter.use("/passkeys", passkeysRouter);

const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);
const emailSchema = z.string().trim().toLowerCase().email("Invalid email address");
const nameSchema = z.string().trim().max(60);

// Clients created before first/last name existed send a single `name`; newer ones send both.
const registerSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    firstName: nameSchema.optional(),
    lastName: nameSchema.optional(),
    email: emailSchema,
    password: passwordSchema,
  })
  .transform((v) => {
    let firstName = v.firstName ?? "";
    let lastName = v.lastName ?? "";
    if (!firstName && v.name) {
      const [first, ...rest] = v.name.split(/\s+/);
      firstName = first;
      lastName = rest.join(" ");
    }
    return { firstName, lastName, email: v.email, password: v.password };
  })
  .refine((v) => v.firstName.length > 0, { message: "First name is required", path: ["firstName"] });

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { firstName, lastName, email, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new AppError(409, "An account with this email already exists");

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { firstName, lastName, name: displayName(firstName, lastName), email, passwordHash },
    });

    const { accessToken, refreshToken } = await issueSession(res, user.id);
    res.status(201).json({ accessToken, refreshToken, user: sanitizeUser(user) });
  })
);

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordMatches = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !passwordMatches) {
      throw new AppError(401, "Invalid email or password");
    }

    const { accessToken, refreshToken } = await issueSession(res, user.id);
    res.json({ accessToken, refreshToken, user: sanitizeUser(user) });
  })
);

/** The signed-in user as the apps see it: GET /me, and POST /refresh?include=user. */
async function currentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        include: { family: { select: { id: true, name: true, currency: true, encryptionEnabled: true, requireApproval: true } } },
      },
      vault: { select: { userId: true } },
    },
  });
  if (!user) throw new AppError(404, "User not found");

  return {
    ...sanitizeUser(user),
    preferences: readPreferences(user.preferences),
    hasVault: user.vault !== null,
    families: user.memberships.map((m) => ({
      id: m.family.id,
      name: m.family.name,
      currency: m.family.currency,
      encryptionEnabled: m.family.encryptionEnabled,
      requireApproval: m.family.requireApproval,
      role: m.role,
    })),
  };
}

// A rotated refresh token presented again within this window is treated as a concurrent-request race
// (two tabs, a retried request) rather than theft.
const REUSE_GRACE_MS = 10_000;
// A rotated token whose successor was never used is honored again for this long: the client most
// likely never received the rotation's response (a phone dropping its connection mid-request, a
// timeout, the app killed before secure storage was written) and is retrying, possibly only the
// next time the app is opened, days later. It gets the same successor back. Once the successor has
// itself been used, a replay is treated as theft — that check is what catches a stolen token, so
// the window can be long without weakening it.
const REPLAY_WINDOW_MS = 30 * 24 * 60 * 60_000;

// An app opening with a stored session needs a token and then the user. `?include=user` returns
// both at once, saving a sequential round trip on every page load.
async function withUser<T extends object>(req: Request, session: T, userId: string) {
  return req.query.include === "user" ? { ...session, user: await currentUser(userId) } : session;
}

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    // The apps send their token in the body. That must win over a cookie: React Native's HTTP
    // client keeps cookies too, but writes them to disk lazily, so after the app is killed the
    // cookie can hold a token that has since been rotated away — and presenting that one looks like
    // theft and signed the whole account out. Web clients send no body token, only the cookie.
    const bodyToken = typeof req.body?.refreshToken === "string" && req.body.refreshToken ? (req.body.refreshToken as string) : null;
    const token = bodyToken ?? req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new AppError(401, "Missing refresh token");
    // Native clients get no cookie, so there is never a second, stale copy of their token.
    const cookieRes = bodyToken ? null : res;

    const tokenHash = hashRefreshToken(token);
    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing || existing.expiresAt < new Date()) {
      if (!bodyToken) res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
      throw new AppError(401, "Refresh token is invalid or expired");
    }

    if (existing.revokedAt) {
      const revokedAgo = Date.now() - existing.revokedAt.getTime();
      if (revokedAgo < REPLAY_WINDOW_MS) {
        const replayed = await replaySession(cookieRes, token);
        if (replayed) {
          res.json(await withUser(req, replayed, existing.userId));
          return;
        }
      }
      // Rotated moments ago: most likely a second tab or request that raced the rotation. Refuse it,
      // but leave the cookie (it may already hold the new token) and the other sessions alone.
      if (revokedAgo < REUSE_GRACE_MS) {
        throw new AppError(401, "Refresh token is invalid or expired");
      }
      // This token was already rotated away. Presenting it again means it leaked (someone else
      // has it, or it was replayed) — burn every session for the account rather than honoring it.
      if (!bodyToken) res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
      await revokeAllSessions(existing.userId);
      throw new AppError(401, "Refresh token is invalid or expired");
    }

    // Conditioned on still being unrevoked, so two concurrent refreshes of the same token can't
    // both rotate it — only the first wins. The loser raced it within the same instant and gets
    // the successor the winner created, so both callers end up holding the same live token.
    const session =
      (await rotateSession(cookieRes, existing.id, existing.userId, token)) ?? (await replaySession(cookieRes, token));
    if (!session) {
      throw new AppError(401, "Refresh token is invalid or expired");
    }
    res.json(await withUser(req, session, existing.userId));
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.body?.refreshToken || req.cookies?.[REFRESH_COOKIE];
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

// ---------------------------------------------------------------------------------------------
// Preferences — one shared shape for web and mobile so a toggle on one shows up on the other.
// ---------------------------------------------------------------------------------------------

const preferencesSchema = z.object({
  defaultView: z.enum(["daily", "calendar"]),
  weekStart: z.enum(["sunday", "monday"]),
  carryOver: z.boolean(),
});
type Preferences = z.infer<typeof preferencesSchema>;

const DEFAULT_PREFERENCES: Preferences = { defaultView: "daily", weekStart: "sunday", carryOver: true };

function readPreferences(stored: Prisma.JsonValue | null): Preferences {
  const parsed = preferencesSchema.partial().safeParse(stored ?? {});
  return { ...DEFAULT_PREFERENCES, ...(parsed.success ? parsed.data : {}) };
}

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await currentUser(req.user!.id));
  })
);

authRouter.put(
  "/me/preferences",
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = preferencesSchema.partial().parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { preferences: true } });
    if (!user) throw new AppError(404, "User not found");
    const next = { ...readPreferences(user.preferences), ...patch };
    await prisma.user.update({ where: { id: req.user!.id }, data: { preferences: next } });
    res.json(next);
  })
);

// ---------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------

const profileSchema = z.object({
  firstName: nameSchema.min(1, "First name is required"),
  lastName: nameSchema,
});

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { firstName, lastName } = profileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { firstName, lastName, name: displayName(firstName, lastName) },
    });
    res.json(sanitizeUser(user));
  })
);

// Deletes the account and everything that was only theirs (see lib/accountDeletion). Confirmed with the
// password, or — for an account that signs in with Google, Microsoft or a passkey and has none — by
// typing the account's email address.
authRouter.delete(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password, confirmEmail } = z
      .object({ password: z.string().optional(), confirmEmail: z.string().trim().toLowerCase().optional() })
      .parse(req.body ?? {});
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw new AppError(404, "User not found");

    if (user.passwordHash) {
      if (!password || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError(400, "Incorrect password");
    } else if (confirmEmail !== user.email.toLowerCase()) {
      throw new AppError(400, "Type your email address to confirm");
    }

    await deleteUserAccount(user.id);
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    res.status(204).send();
  })
);

// Email change: password → code to the current address → code to the new address → swap.
// Each verified step hands back a short-lived token that the next step must present.
const EMAIL_CHANGE_TOKEN = "email-change";
interface EmailChangeClaims {
  sub: string;
  currentEmail: string;
}

function readEmailChangeToken(token: unknown, userId: string, currentEmail: string) {
  if (typeof token !== "string") throw new AppError(400, "Verification token is required");
  try {
    const claims = verifyPurposeToken<EmailChangeClaims>(EMAIL_CHANGE_TOKEN, token);
    if (claims.sub === userId && claims.currentEmail === currentEmail) return claims;
  } catch {
    // fall through
  }
  throw new AppError(400, "Your verification has expired. Please start again.");
}

async function loadUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, "User not found");
  return user;
}

authRouter.post(
  "/me/email/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1, "Password is required") }).parse(req.body);
    const user = await loadUser(req.user!.id);
    if (!user.passwordHash) {
      throw new AppError(400, "Your account doesn't have a password yet. Sign out and use “Forgot password” to create one.");
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) throw new AppError(400, "Incorrect password");

    const code = await createCode(user.email, VerificationPurpose.EMAIL_CHANGE_CURRENT, user.id);
    await sendCodeEmail(user.email, "Confirm it's you", code, "Enter this code to continue changing your email address.");
    res.json({ sentTo: user.email });
  })
);

authRouter.post(
  "/me/email/verify-current",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(1) }).parse(req.body);
    const user = await loadUser(req.user!.id);
    await consumeCode(user.email, VerificationPurpose.EMAIL_CHANGE_CURRENT, code);
    const token = signPurposeToken(EMAIL_CHANGE_TOKEN, { sub: user.id, currentEmail: user.email }, "15m");
    res.json({ token });
  })
);

authRouter.post(
  "/me/email/request-new",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token, newEmail } = z.object({ token: z.string(), newEmail: emailSchema }).parse(req.body);
    const user = await loadUser(req.user!.id);
    readEmailChangeToken(token, user.id, user.email);

    if (newEmail === user.email) throw new AppError(400, "That's already your email address");
    if (await prisma.user.findUnique({ where: { email: newEmail } })) {
      throw new AppError(409, "An account with this email already exists");
    }

    const code = await createCode(newEmail, VerificationPurpose.EMAIL_CHANGE_NEW, user.id);
    await sendCodeEmail(newEmail, "Verify your new email", code, "Enter this code to finish moving your Family Finance account to this address.");
    res.json({ sentTo: newEmail });
  })
);

authRouter.post(
  "/me/email/confirm-new",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token, newEmail, code } = z
      .object({ token: z.string(), newEmail: emailSchema, code: z.string().trim().min(1) })
      .parse(req.body);
    const user = await loadUser(req.user!.id);
    readEmailChangeToken(token, user.id, user.email);

    const record = await consumeCode(newEmail, VerificationPurpose.EMAIL_CHANGE_NEW, code);
    if (record.userId !== user.id) throw new AppError(400, "That code is invalid or has expired");
    if (await prisma.user.findUnique({ where: { email: newEmail } })) {
      throw new AppError(409, "An account with this email already exists");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail, emailVerifiedAt: new Date() },
    });

    await sendMail({
      to: user.email,
      subject: "Your Family Finance email was changed",
      text: `The email address on your Family Finance account was changed to ${newEmail}. If this wasn't you, reset your password immediately.`,
    }).catch(() => undefined);

    res.json(sanitizeUser(updated));
  })
);

// ---------------------------------------------------------------------------------------------
// Forgot password — emailed 6-digit code, identical on web and mobile (no deep links needed).
// ---------------------------------------------------------------------------------------------

authRouter.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      try {
        const code = await createCode(email, VerificationPurpose.PASSWORD_RESET, user.id);
        await sendCodeEmail(email, "Reset your password", code, "Enter this code in Family Finance to choose a new password.");
      } catch (err) {
        // Don't reveal whether the account exists through a cooldown error.
        if (!(err instanceof AppError && err.status === 429)) throw err;
      }
    }
    // Same response either way so the endpoint can't be used to probe for accounts.
    res.json({ ok: true });
  })
);

authRouter.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const { email, code, password } = z
      .object({ email: emailSchema, code: z.string().trim().min(1), password: passwordSchema })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError(400, "That code is invalid or has expired");
    await consumeCode(email, VerificationPurpose.PASSWORD_RESET, code);

    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    });
    // A reset means the old password may be compromised — sign out every other device.
    await revokeAllSessions(user.id);

    const { accessToken, refreshToken } = await issueSession(res, user.id);
    res.json({ accessToken, refreshToken, user: sanitizeUser(updated) });
  })
);

// ---------------------------------------------------------------------------------------------
// Zero-knowledge vault. Everything here is opaque ciphertext / public material; the master
// password and private key never leave the client.
// ---------------------------------------------------------------------------------------------

const b64 = z.string().regex(/^[A-Za-z0-9+/=_.-]+$/, "Invalid encoding").max(4096);
const vaultSchema = z.object({
  kdfSalt: b64,
  kdfIterations: z.number().int().min(100_000).max(10_000_000),
  publicKey: b64,
  encryptedPrivateKey: b64,
});

authRouter.get(
  "/vault",
  requireAuth,
  asyncHandler(async (req, res) => {
    const vault = await prisma.userVault.findUnique({ where: { userId: req.user!.id } });
    res.json({
      vault: vault
        ? {
            kdfSalt: vault.kdfSalt,
            kdfIterations: vault.kdfIterations,
            publicKey: vault.publicKey,
            encryptedPrivateKey: vault.encryptedPrivateKey,
          }
        : null,
    });
  })
);

// Creates the vault, or replaces it. Re-wrapping the same key pair (a master password change)
// keeps family access; a new key pair (a reset) invalidates the family keys sealed to the old one.
authRouter.put(
  "/vault",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = vaultSchema.parse(req.body);
    const userId = req.user!.id;
    const existing = await prisma.userVault.findUnique({ where: { userId } });

    await prisma.$transaction(async (tx) => {
      if (existing && existing.publicKey !== data.publicKey) {
        await tx.familyKey.deleteMany({ where: { userId } });
      }
      await tx.userVault.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    });
    res.json({ ok: true });
  })
);

authRouter.delete(
  "/vault",
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await prisma.$transaction([
      prisma.familyKey.deleteMany({ where: { userId } }),
      prisma.userVault.deleteMany({ where: { userId } }),
    ]);
    res.status(204).send();
  })
);
