import { z } from "zod";
import { prisma } from "./prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Prefix of a client-side encrypted field (AES-256-GCM under the family data key). The server
 * never holds that key — it only checks the shape, so an encrypted family can't be written to in
 * plaintext by an out-of-date client.
 */
export const ENCRYPTED_PREFIX = "ffenc1:";

export function isEncryptedValue(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

/** A free-text field that may be plaintext (bounded by `plainMax`) or ciphertext (bounded by `cipherMax`). */
export function maybeEncryptedText(plainMax: number, cipherMax: number) {
  return z
    .string()
    .trim()
    .refine((v) => v.length <= (isEncryptedValue(v) ? cipherMax : plainMax), {
      message: `Must be at most ${plainMax} characters`,
    });
}

/** Rejects plaintext payee/notes for a family that uses end-to-end encryption. */
export function checkEncryptionPolicy(encryptionEnabled: boolean, fields: Record<string, string | null | undefined>) {
  if (!encryptionEnabled) return;
  for (const [name, value] of Object.entries(fields)) {
    if (value && !isEncryptedValue(value)) {
      throw new AppError(
        400,
        `This family uses end-to-end encryption. Unlock your vault (or update the app) before saving ${name}.`
      );
    }
  }
}

export async function assertEncryptionPolicy(familyId: string, fields: Record<string, string | null | undefined>) {
  // Nothing to check without a value: skip the read.
  if (!Object.values(fields).some(Boolean)) return;
  const family = await prisma.family.findUnique({ where: { id: familyId }, select: { encryptionEnabled: true } });
  checkEncryptionPolicy(!!family?.encryptionEnabled, fields);
}
