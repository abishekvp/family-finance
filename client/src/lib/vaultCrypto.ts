// Zero-knowledge vault primitives. This file is mirrored byte-for-byte (apart from the platform
// hooks at the bottom) in mobile/src/lib/vaultCrypto.ts — both clients must produce and read the
// exact same formats.
//
//   master password ──PBKDF2-SHA256──▶ KEK ──AES-GCM──▶ wraps the user's X25519 private key
//   family data key (32 random bytes) ──sealed (X25519 + HKDF + AES-GCM)──▶ each member's public key
//   payee / notes ──AES-GCM under the family data key──▶ "ffenc1:<nonce>.<ciphertext>"
//
// The server stores only the salt, iteration count, public key and ciphertexts.
import { x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const ENCRYPTED_PREFIX = "ffenc1:";
export const LOCKED_PLACEHOLDER = "🔒 Encrypted";
export const DEFAULT_KDF_ITERATIONS = 600_000;

const VAULT_AAD = utf8("ff-vault-v1");
const FAMILY_KEY_INFO = utf8("ff-family-key-v1");

export interface VaultRecord {
  kdfSalt: string;
  kdfIterations: number;
  publicKey: string;
  encryptedPrivateKey: string;
}

export interface CryptoPlatform {
  randomBytes(length: number): Uint8Array;
  pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number): Promise<Uint8Array>;
}

// ---- encoding -------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Map([...B64].map((c, i) => [c, i]));

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[n & 63] : "=";
  }
  return out;
}

export function fromBase64(value: string): Uint8Array {
  const clean = value.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const c of clean) {
    const v = B64_LOOKUP.get(c);
    if (v === undefined) throw new Error("Invalid base64");
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

export function utf8(value: string): Uint8Array {
  const out: number[] = [];
  for (const ch of value) {
    let cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else {
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
  }
  return Uint8Array.from(out);
}

export function fromUtf8(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    let cp: number;
    if (b < 0x80) cp = b;
    else if (b < 0xe0) cp = ((b & 31) << 6) | (bytes[i++] & 63);
    else if (b < 0xf0) cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    else cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
    out += String.fromCodePoint(cp);
  }
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---- vault ----------------------------------------------------------------------------------

export class WrongPasswordError extends Error {
  constructor() {
    super("Incorrect master password");
  }
}

async function deriveKek(p: CryptoPlatform, password: string, salt: Uint8Array, iterations: number) {
  return p.pbkdf2Sha256(utf8(password.normalize("NFKC")), salt, iterations);
}

function wrapPrivateKey(p: CryptoPlatform, kek: Uint8Array, privateKey: Uint8Array): string {
  const nonce = p.randomBytes(12);
  const ct = gcm(kek, nonce, VAULT_AAD).encrypt(privateKey);
  return `v1.${toBase64(nonce)}.${toBase64(ct)}`;
}

/** Creates a fresh key pair protected by `password`. Returns the record to store and the private key. */
export async function createVault(p: CryptoPlatform, password: string, iterations = DEFAULT_KDF_ITERATIONS) {
  const salt = p.randomBytes(16);
  const privateKey = p.randomBytes(32);
  const kek = await deriveKek(p, password, salt, iterations);
  const record: VaultRecord = {
    kdfSalt: toBase64(salt),
    kdfIterations: iterations,
    publicKey: toBase64(x25519.getPublicKey(privateKey)),
    encryptedPrivateKey: wrapPrivateKey(p, kek, privateKey),
  };
  return { record, privateKey };
}

/** Same key pair, new master password (keeps every family key sealed to it valid). */
export async function rewrapVault(p: CryptoPlatform, record: VaultRecord, privateKey: Uint8Array, newPassword: string) {
  const salt = p.randomBytes(16);
  const kek = await deriveKek(p, newPassword, salt, DEFAULT_KDF_ITERATIONS);
  return {
    ...record,
    kdfSalt: toBase64(salt),
    kdfIterations: DEFAULT_KDF_ITERATIONS,
    encryptedPrivateKey: wrapPrivateKey(p, kek, privateKey),
  } satisfies VaultRecord;
}

export async function openVault(p: CryptoPlatform, record: VaultRecord, password: string): Promise<Uint8Array> {
  const kek = await deriveKek(p, password, fromBase64(record.kdfSalt), record.kdfIterations);
  const [version, nonce, ct] = record.encryptedPrivateKey.split(".");
  if (version !== "v1") throw new Error("Unsupported vault format");
  try {
    return gcm(kek, fromBase64(nonce), VAULT_AAD).decrypt(fromBase64(ct));
  } catch {
    throw new WrongPasswordError();
  }
}

// ---- family key sealing --------------------------------------------------------------------

export function newFamilyKey(p: CryptoPlatform): Uint8Array {
  return p.randomBytes(32);
}

function sealingKey(shared: Uint8Array, ephemeralPub: Uint8Array, recipientPub: Uint8Array) {
  return hkdf(sha256, shared, concat(ephemeralPub, recipientPub), FAMILY_KEY_INFO, 32);
}

export function sealFamilyKey(p: CryptoPlatform, familyKey: Uint8Array, recipientPublicKey: string): string {
  const recipientPub = fromBase64(recipientPublicKey);
  const ephemeral = p.randomBytes(32);
  const ephemeralPub = x25519.getPublicKey(ephemeral);
  const key = sealingKey(x25519.getSharedSecret(ephemeral, recipientPub), ephemeralPub, recipientPub);
  const nonce = p.randomBytes(12);
  const ct = gcm(key, nonce).encrypt(familyKey);
  return `v1.${toBase64(ephemeralPub)}.${toBase64(nonce)}.${toBase64(ct)}`;
}

export function openFamilyKey(wrapped: string, privateKey: Uint8Array): Uint8Array {
  const [version, eph, nonce, ct] = wrapped.split(".");
  if (version !== "v1") throw new Error("Unsupported key format");
  const ephemeralPub = fromBase64(eph);
  const ownPub = x25519.getPublicKey(privateKey);
  const key = sealingKey(x25519.getSharedSecret(privateKey, ephemeralPub), ephemeralPub, ownPub);
  return gcm(key, fromBase64(nonce)).decrypt(fromBase64(ct));
}

// ---- device-bound wrapping (easy unlock) ---------------------------------------------------

const EASY_UNLOCK_INFO = utf8("ff-easy-unlock-v1");

/** Wraps the vault private key under device-held secret material (e.g. a passkey's PRF output). */
export function wrapWithSecret(p: CryptoPlatform, secret: Uint8Array, data: Uint8Array): string {
  const key = hkdf(sha256, secret, undefined, EASY_UNLOCK_INFO, 32);
  const nonce = p.randomBytes(12);
  return `v1.${toBase64(nonce)}.${toBase64(gcm(key, nonce).encrypt(data))}`;
}

export function unwrapWithSecret(secret: Uint8Array, wrapped: string): Uint8Array {
  const [version, nonce, ct] = wrapped.split(".");
  if (version !== "v1") throw new Error("Unsupported format");
  const key = hkdf(sha256, secret, undefined, EASY_UNLOCK_INFO, 32);
  return gcm(key, fromBase64(nonce)).decrypt(fromBase64(ct));
}

// ---- field encryption ----------------------------------------------------------------------

function fieldAad(familyId: string) {
  return utf8(`ff-field-v1:${familyId}`);
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptField(p: CryptoPlatform, familyKey: Uint8Array, familyId: string, plaintext: string): string {
  const nonce = p.randomBytes(12);
  const ct = gcm(familyKey, nonce, fieldAad(familyId)).encrypt(utf8(plaintext));
  return `${ENCRYPTED_PREFIX}${toBase64(nonce)}.${toBase64(ct)}`;
}

export function decryptField(familyKey: Uint8Array, familyId: string, value: string): string {
  const [nonce, ct] = value.slice(ENCRYPTED_PREFIX.length).split(".");
  return fromUtf8(gcm(familyKey, fromBase64(nonce), fieldAad(familyId)).decrypt(fromBase64(ct)));
}

// ---- platform hooks (web) ------------------------------------------------------------------

export const platform: CryptoPlatform = {
  randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  },
  async pbkdf2Sha256(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", password as BufferSource, "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
      base,
      256
    );
    return new Uint8Array(bits);
  },
};
