import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ChallengePurpose, OAuthProvider } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { asyncHandler, AppError } from "../middleware/errorHandler";
import { MOBILE_OAUTH_REDIRECT, publicAppUrl } from "../lib/config";
import { signPurposeToken, verifyPurposeToken } from "../lib/jwt";
import { displayName, issueSession } from "../lib/session";

// Sign in with Google / Microsoft via a server-side authorization-code flow (with PKCE + nonce).
// The web app navigates here directly; the Android app opens the same URL in a Custom Tab and
// gets bounced back to familyfinance://oauth-callback with a one-time code to exchange. That keeps
// one client registration per provider and no native SDKs.

export const oauthRouter = Router();

type Platform = "web" | "mobile";

interface ProviderConfig {
  provider: OAuthProvider;
  clientId?: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  extraParams?: Record<string, string>;
}

const MICROSOFT_TENANT = process.env.MICROSOFT_TENANT?.trim() || "common";
// Personal Microsoft accounts all live in this tenant; their email addresses are verified by Microsoft.
const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

const PROVIDERS: Record<string, () => ProviderConfig> = {
  google: () => ({
    provider: OAuthProvider.GOOGLE,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    extraParams: { prompt: "select_account" },
  }),
  microsoft: () => ({
    provider: OAuthProvider.MICROSOFT,
    clientId: process.env.MICROSOFT_CLIENT_ID,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    authorizeUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`,
    scope: "openid email profile",
    extraParams: { prompt: "select_account", response_mode: "query" },
  }),
};

const STATE_COOKIE = "oauthState";
const STATE_PURPOSE = "oauth-state";
const EXCHANGE_TTL_MS = 2 * 60 * 1000;

interface StateClaims {
  state: string;
  verifier: string;
  nonce: string;
  provider: string;
  platform: Platform;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function redirectUri(providerKey: string) {
  return `${publicAppUrl()}/api/auth/oauth/${providerKey}/callback`;
}

function isConfigured(cfg: ProviderConfig) {
  return Boolean(cfg.clientId && cfg.clientSecret);
}

function finishWithError(res: Response, platform: Platform, message: string) {
  if (platform === "mobile") {
    res.redirect(`${MOBILE_OAUTH_REDIRECT}?error=${encodeURIComponent(message)}`);
  } else {
    res.redirect(`${publicAppUrl()}/login?oauth_error=${encodeURIComponent(message)}`);
  }
}

oauthRouter.get("/providers", (_req, res) => {
  res.json({
    google: isConfigured(PROVIDERS.google()),
    microsoft: isConfigured(PROVIDERS.microsoft()),
  });
});

oauthRouter.get("/:provider/start", (req: Request, res: Response) => {
  const platform: Platform = req.query.platform === "mobile" ? "mobile" : "web";
  const factory = PROVIDERS[req.params.provider];
  if (!factory) return finishWithError(res, platform, "Unknown sign-in provider");
  const cfg = factory();
  if (!isConfigured(cfg)) {
    return finishWithError(res, platform, `${req.params.provider === "google" ? "Google" : "Microsoft"} sign-in isn't configured on this server yet`);
  }

  const claims: StateClaims = {
    state: randomToken(),
    verifier: randomToken(48),
    nonce: randomToken(),
    provider: req.params.provider,
    platform,
  };
  res.cookie(STATE_COOKIE, signPurposeToken(STATE_PURPOSE, { ...claims }, "10m"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/oauth",
    maxAge: 10 * 60 * 1000,
  });

  const challenge = crypto.createHash("sha256").update(claims.verifier).digest("base64url");
  const params = new URLSearchParams({
    client_id: cfg.clientId!,
    redirect_uri: redirectUri(req.params.provider),
    response_type: "code",
    scope: cfg.scope,
    state: claims.state,
    nonce: claims.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...cfg.extraParams,
  });
  res.redirect(`${cfg.authorizeUrl}?${params.toString()}`);
});

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  nonce?: string;
  tid?: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
}

function decodeJwtPayload(token: string): IdTokenClaims {
  const [, payload] = token.split(".");
  if (!payload) throw new Error("Malformed id_token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function exchangeCode(cfg: ProviderConfig, providerKey: string, code: string, verifier: string) {
  const body = new URLSearchParams({
    client_id: cfg.clientId!,
    client_secret: cfg.clientSecret!,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(providerKey),
  });
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await tokenRes.json()) as { id_token?: string; error_description?: string };
  if (!tokenRes.ok || !json.id_token) {
    throw new Error(json.error_description ?? `Token endpoint responded ${tokenRes.status}`);
  }
  // The id_token came straight from the provider's token endpoint over TLS, authenticated with
  // our client secret, so (per OIDC Core §3.1.3.7) we validate its claims rather than its signature.
  return decodeJwtPayload(json.id_token);
}

async function resolveUser(provider: OAuthProvider, claims: IdTokenClaims) {
  const subject = claims.sub!;
  const email = (claims.email ?? claims.preferred_username ?? "").trim().toLowerCase();

  const identity = await prisma.oAuthIdentity.findUnique({
    where: { provider_subject: { provider, subject } },
    include: { user: true },
  });
  if (identity) return identity.user;

  if (!email || !email.includes("@")) {
    throw new AppError(400, "Your account didn't share an email address");
  }

  // Only link to an existing account when the provider vouches for the address — otherwise anyone
  // who can set an arbitrary email on a work/school tenant could take over accounts.
  const emailTrusted =
    provider === OAuthProvider.GOOGLE ? claims.email_verified === true : claims.tid === MICROSOFT_CONSUMER_TENANT;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (!emailTrusted) {
      throw new AppError(409, "An account with this email already exists. Sign in with your password instead.");
    }
    await prisma.oAuthIdentity.create({ data: { provider, subject, email, userId: existing.id } });
    return existing;
  }

  // Same reasoning as the linking case above, but for account creation: an untrusted address lets
  // anyone who controls a work/school tenant pre-register someone else's email before they sign up,
  // then keep a standing sign-in to the account even after the real owner resets their password.
  if (!emailTrusted) {
    throw new AppError(
      409,
      "This provider didn't confirm your email address, so we can't create an account with it. Register with a password instead."
    );
  }

  let firstName = claims.given_name?.trim() ?? "";
  let lastName = claims.family_name?.trim() ?? "";
  if (!firstName) {
    const [first, ...rest] = (claims.name ?? email.split("@")[0]).trim().split(/\s+/);
    firstName = first;
    lastName = rest.join(" ");
  }

  return prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      name: displayName(firstName, lastName),
      passwordHash: null,
      emailVerifiedAt: new Date(),
      oauthIdentities: { create: { provider, subject, email } },
    },
  });
}

oauthRouter.get(
  "/:provider/callback",
  asyncHandler(async (req, res) => {
    const providerKey = req.params.provider;
    const rawState = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { path: "/api/auth/oauth" });

    let state: StateClaims;
    try {
      state = verifyPurposeToken<StateClaims>(STATE_PURPOSE, rawState ?? "");
    } catch {
      return finishWithError(res, "web", "Your sign-in session expired. Please try again.");
    }
    const platform = state.platform;

    const factory = PROVIDERS[providerKey];
    if (!factory || state.provider !== providerKey || req.query.state !== state.state) {
      return finishWithError(res, platform, "Sign-in could not be verified. Please try again.");
    }
    if (typeof req.query.error === "string") {
      const cancelled = req.query.error === "access_denied";
      return finishWithError(res, platform, cancelled ? "Sign-in was cancelled" : String(req.query.error_description ?? req.query.error));
    }
    if (typeof req.query.code !== "string") return finishWithError(res, platform, "Missing authorization code");

    const cfg = factory();
    try {
      const claims = await exchangeCode(cfg, providerKey, req.query.code, state.verifier);
      const audOk = claims.aud === cfg.clientId;
      const issOk =
        cfg.provider === OAuthProvider.GOOGLE
          ? claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com"
          : Boolean(claims.iss?.startsWith("https://login.microsoftonline.com/"));
      if (!audOk || !issOk || claims.nonce !== state.nonce || !claims.sub || (claims.exp ?? 0) * 1000 < Date.now()) {
        return finishWithError(res, platform, "Sign-in response could not be verified");
      }

      const user = await resolveUser(cfg.provider, claims);

      if (platform === "mobile") {
        const code = randomToken();
        await prisma.authChallenge.create({
          data: {
            userId: user.id,
            purpose: ChallengePurpose.OAUTH_EXCHANGE,
            challenge: crypto.createHash("sha256").update(code).digest("hex"),
            expiresAt: new Date(Date.now() + EXCHANGE_TTL_MS),
          },
        });
        return res.redirect(`${MOBILE_OAUTH_REDIRECT}?code=${encodeURIComponent(code)}`);
      }

      await issueSession(res, user.id);
      res.redirect(`${publicAppUrl()}/login`);
    } catch (err) {
      const message = err instanceof AppError ? err.message : "Sign-in failed. Please try again.";
      if (!(err instanceof AppError)) console.error("[oauth] callback failed:", err);
      finishWithError(res, platform, message);
    }
  })
);

// Mobile: trade the one-time code from the deep link for a normal session.
oauthRouter.post(
  "/exchange",
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().min(1) }).parse(req.body);
    const challenge = crypto.createHash("sha256").update(code).digest("hex");
    const record = await prisma.authChallenge.findUnique({ where: { challenge } });
    if (!record || record.purpose !== ChallengePurpose.OAUTH_EXCHANGE || !record.userId || record.expiresAt < new Date()) {
      throw new AppError(400, "Sign-in link expired. Please try again.");
    }
    await prisma.authChallenge.delete({ where: { id: record.id } });
    const tokens = await issueSession(res, record.userId);
    res.json(tokens);
  })
);
