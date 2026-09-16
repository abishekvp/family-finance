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
