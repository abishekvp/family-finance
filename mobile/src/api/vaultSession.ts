// In-memory holder for unlocked family data keys, plus the transforms the API client applies so
// that payee/notes are encrypted on the way out and decrypted on the way in. Keys never touch
// storage here — they vanish on reload, which is what makes the master password "every session".
import { ClientError } from "./errors";
import {
  decryptField,
  encryptField,
  isEncrypted,
  LOCKED_PLACEHOLDER,
  platform,
} from "../lib/vaultCrypto";

const ENCRYPTED_FIELDS = ["payee", "notes"] as const;

const familyKeys = new Map<string, Uint8Array>();
const encryptedFamilies = new Set<string>();

// Bumped whenever a key comes or goes, so anything holding decrypted copies knows to redo them.
let keyVersion = 0;
const keyListeners = new Set<() => void>();

function keysChanged() {
  keyVersion++;
  keyListeners.forEach((l) => l());
}

export function getKeyVersion() {
  return keyVersion;
}

export function subscribeKeys(listener: () => void) {
  keyListeners.add(listener);
  return () => {
    keyListeners.delete(listener);
  };
}

export function setFamilyKey(familyId: string, key: Uint8Array | null) {
  if (key) familyKeys.set(familyId, key);
  else familyKeys.delete(familyId);
  keysChanged();
}

export function hasFamilyKey(familyId: string) {
  return familyKeys.has(familyId);
}

export function setFamilyEncrypted(familyId: string, enabled: boolean) {
  if (enabled) encryptedFamilies.add(familyId);
  else encryptedFamilies.delete(familyId);
}

export function clearVaultSession() {
  familyKeys.clear();
  encryptedFamilies.clear();
  keysChanged();
}

/** Encrypts payee/notes in an outgoing transaction payload (returns a new object). */
export function encryptOutgoing(familyId: string, data: Record<string, unknown>): Record<string, unknown> {
  if (!encryptedFamilies.has(familyId)) return data;
  const key = familyKeys.get(familyId);
  const out = { ...data };
  for (const field of ENCRYPTED_FIELDS) {
    const value = out[field];
    if (typeof value !== "string" || value === "" || isEncrypted(value)) continue;
    if (value === LOCKED_PLACEHOLDER) {
      // Round-tripped placeholder from a locked view: leave the stored ciphertext untouched.
      delete out[field];
      continue;
    }
    if (!key) throw new ClientError("Unlock your vault with your master password to save payee or notes.");
    out[field] = encryptField(platform, key, familyId, value);
  }
  return out;
}

function decryptRecord(record: unknown) {
  if (!record || typeof record !== "object") return;
  const obj = record as Record<string, unknown>;
  const familyId = typeof obj.familyId === "string" ? obj.familyId : null;
  for (const field of ENCRYPTED_FIELDS) {
    const value = obj[field];
    if (!isEncrypted(value)) continue;
    const key = familyId ? familyKeys.get(familyId) : undefined;
    try {
      obj[field] = key ? decryptField(key, familyId!, value) : LOCKED_PLACEHOLDER;
    } catch {
      obj[field] = LOCKED_PLACEHOLDER;
    }
  }
}

/** A copy of a record with payee/notes decrypted, leaving the (still sealed) original as it was. */
export function decryptedCopy<T extends object>(record: T): T {
  const copy = { ...record };
  decryptRecord(copy);
  return copy;
}

/** Decrypts payee/notes in place on a transaction or list of transactions. */
export function decryptIncoming(data: unknown) {
  if (Array.isArray(data)) data.forEach(decryptRecord);
  else decryptRecord(data);
}
