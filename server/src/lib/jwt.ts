import crypto from "crypto";
import jwt from "jsonwebtoken";

const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, requireEnv("JWT_ACCESS_SECRET"), {
    expiresIn: ACCESS_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): { sub: string } {
  return jwt.verify(token, requireEnv("JWT_ACCESS_SECRET")) as { sub: string };
}

export function generateRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashRefreshToken(token);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  return { token, tokenHash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * The token a refresh token rotates into. Derived from the old token (rather than random) so that a
 * client whose refresh response got lost — a dropped connection, a timeout, the app being killed —
 * can present the old token again and be handed the very same successor, instead of looking like a
 * replayed (stolen) token. Only someone holding the old token can compute it.
 */
export function successorRefreshToken(token: string): { token: string; tokenHash: string; expiresAt: Date } {
  const next = crypto.createHmac("sha256", purposeSecret("refresh-rotation")).update(token).digest("hex");
  return { token: next, tokenHash: hashRefreshToken(next), expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) };
}

// Short-lived, single-purpose tokens (an in-progress email change, OAuth state). They're signed
// with a purpose-specific secret so they can never be replayed as access tokens, or vice versa.
function purposeSecret(purpose: string) {
  return `${requireEnv("JWT_ACCESS_SECRET")}:${purpose}`;
}

export function signPurposeToken(purpose: string, payload: Record<string, unknown>, expiresIn: `${number}m`): string {
  return jwt.sign(payload, purposeSecret(purpose), { expiresIn });
}

export function verifyPurposeToken<T>(purpose: string, token: string): T {
  return jwt.verify(token, purposeSecret(purpose)) as T;
}
