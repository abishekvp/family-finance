import crypto from "crypto";
import type { VerificationPurpose } from "@prisma/client";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(code: string, email: string, purpose: VerificationPurpose) {
  const secret = process.env.JWT_ACCESS_SECRET ?? "";
  return crypto.createHmac("sha256", secret).update(`${purpose}:${email}:${code}`).digest("hex");
}

/** Creates (replacing any outstanding one) a 6-digit code for email+purpose and returns it. */
export async function createCode(email: string, purpose: VerificationPurpose, userId: string | null): Promise<string> {
  const latest = await prisma.verificationCode.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError(429, "Please wait a moment before requesting another code");
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.$transaction([
    prisma.verificationCode.updateMany({ where: { email, purpose, consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.verificationCode.create({
      data: { email, purpose, userId, codeHash: hashCode(code, email, purpose), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    }),
  ]);
  return code;
}

/** Validates and consumes the outstanding code. Throws a 400 on any mismatch. */
export async function consumeCode(email: string, purpose: VerificationPurpose, code: string) {
  const record = await prisma.verificationCode.findFirst({
    where: { email, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const invalid = new AppError(400, "That code is invalid or has expired");
  if (!record || record.expiresAt < new Date() || record.attempts >= MAX_ATTEMPTS) throw invalid;

  const expected = Buffer.from(record.codeHash, "hex");
  const actual = Buffer.from(hashCode(code.trim(), email, purpose), "hex");
  if (!crypto.timingSafeEqual(expected, actual)) {
    // Conditioned on the attempts we just read, so concurrent guesses each consume one of the
    // MAX_ATTEMPTS tries instead of all racing past the same stale count.
    await prisma.verificationCode.updateMany({
      where: { id: record.id, attempts: record.attempts },
      data: { attempts: { increment: 1 } },
    });
    throw invalid;
  }
  // Conditioned on still being unconsumed, so two concurrent correct guesses can't both succeed.
  const { count } = await prisma.verificationCode.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (count === 0) throw invalid;
  return record;
}
