import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { ClientError } from "../api/errors";
import { setFamilyEncrypted, setFamilyKey } from "../api/vaultSession";
import { useAuth } from "./AuthContext";
import { verifyWithPasskey } from "../lib/passkeys";
import {
  createVault,
  decryptField,
  encryptField,
  fromBase64,
  isEncrypted,
  newFamilyKey,
  openFamilyKey,
  openVault,
  platform,
  rewrapVault,
  sealFamilyKey,
  toBase64,
  unwrapWithSecret,
  wrapWithSecret,
  type VaultRecord,
} from "../lib/vaultCrypto";

/**
 * none     – no vault and the family isn't encrypted; nothing to unlock
 * setup    – the family is encrypted but this user has no vault yet
 * locked   – a vault exists; the master password (or easy unlock) is required this session
 * unlocked – private key in memory; family key loaded if this user has been granted one
 */
export type VaultStatus = "loading" | "none" | "setup" | "locked" | "unlocked";

interface EncryptionMember {
  userId: string;
  name: string;
  publicKey: string | null;
  hasKey: boolean;
}

interface FamilyEncryptionState {
  enabled: boolean;
  wrappedKey: string | null;
  members: EncryptionMember[];
}

interface EasyUnlockRecord {
  credentialId: string;
  salt: string;
  wrapped: string;
}

interface SecurityContextValue {
  status: VaultStatus;
  /** Family is encrypted but this member hasn't been granted the key yet. */
  awaitingAccess: boolean;
  familyEncryption: FamilyEncryptionState | null;
  progress: string | null;
  setupSkipped: boolean;
  skipSetup: () => void;
  setupVault: (masterPassword: string) => Promise<void>;
  unlock: (masterPassword: string) => Promise<void>;
  changeMasterPassword: (current: string, next: string) => Promise<void>;
  resetVault: (newMasterPassword: string) => Promise<void>;
  removeVault: () => Promise<void>;
  enableFamilyEncryption: () => Promise<void>;
  disableFamilyEncryption: () => Promise<void>;
  easyUnlockEnabled: boolean;
  enableEasyUnlock: () => Promise<void>;
  disableEasyUnlock: () => void;
  screenLockEnabled: boolean;
  screenLocked: boolean;
  enableScreenLock: () => Promise<void>;
  disableScreenLock: () => void;
  /** Passkey ceremony that clears the screen lock and, with easy unlock, the vault too. */
  unlockWithPasskey: () => Promise<void>;
}

const SecurityContext = createContext<SecurityContextValue | undefined>(undefined);

const SCREEN_LOCK_IDLE_MS = 5 * 60 * 1000;

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable — the feature simply won't persist on this device
  }
}

export function SecurityProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const family = user?.families[0];
  const familyId = family?.id;
  const isAdmin = family?.role === "ADMIN";

  const [status, setStatus] = useState<VaultStatus>("loading");
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [familyEncryption, setFamilyEncryption] = useState<FamilyEncryptionState | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const privateKeyRef = useRef<Uint8Array | null>(null);
  const familyKeyRef = useRef<Uint8Array | null>(null);

  const easyKey = user ? `ff.easyUnlock.${user.id}` : null;
  const screenKey = user ? `ff.screenLock.${user.id}` : null;
  const [easyUnlockEnabled, setEasyUnlockEnabled] = useState(false);
  const [screenLockEnabled, setScreenLockEnabled] = useState(false);
  const [screenLocked, setScreenLocked] = useState(false);

  // ---- load on sign-in ---------------------------------------------------------------------
  const userId = user?.id;
  const familyEncrypted = family?.encryptionEnabled ?? false;
  const hasVault = user?.hasVault ?? false;
  useEffect(() => {
    privateKeyRef.current = null;
    familyKeyRef.current = null;
    setFamilyEncryption(null);
    if (!userId) {
      setStatus("loading");
      setVault(null);
      return;
    }
    const screenOn = storageGet(`ff.screenLock.${userId}`) === "1";
    setScreenLockEnabled(screenOn);
    setScreenLocked(screenOn);
    setEasyUnlockEnabled(storageGet(`ff.easyUnlock.${userId}`) !== null);

    // Most people have no vault, and /auth/me already says so: skip the round trip for them.
    if (!hasVault) {
      setVault(null);
      setStatus(familyEncrypted ? "setup" : "none");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    api
      .get<{ vault: VaultRecord | null }>("/auth/vault")
      .then(({ data }) => {
        if (cancelled) return;
        setVault(data.vault);
        setStatus(data.vault ? "locked" : familyEncrypted ? "setup" : "none");
      })
      .catch(() => !cancelled && setStatus("none"));
    return () => {
      cancelled = true;
    };
    // Only re-run on a different account — not on every /auth/me refresh.
  }, [userId]);

  useEffect(() => {
    if (familyId) setFamilyEncrypted(familyId, familyEncrypted);
  }, [familyId, familyEncrypted]);

  // Re-lock the screen after the tab has been hidden for a while.
  useEffect(() => {
    if (!screenLockEnabled) return;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > SCREEN_LOCK_IDLE_MS) setScreenLocked(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [screenLockEnabled]);

  // ---- family key handling -----------------------------------------------------------------
  const loadFamilyEncryption = useCallback(async () => {
    if (!familyId) return null;
    const { data } = await api.get<FamilyEncryptionState>(`/families/${familyId}/encryption`);
    setFamilyEncryption(data);
    setFamilyEncrypted(familyId, data.enabled);
    return data;
  }, [familyId]);

  const convertAll = useCallback(
    async (direction: "encrypt" | "decrypt", key: Uint8Array) => {
      if (!familyId) return;
      for (;;) {
        const { data } = await api.get<{ items: { id: string; kind?: "transaction" | "recurring"; payee: string | null; notes: string | null }[]; remaining: number }>(
          `/families/${familyId}/encryption/pending`,
          { params: { direction, includeRecurring: "1" } }
        );
        if (data.items.length === 0) break;
        setProgress(`${direction === "encrypt" ? "Encrypting" : "Decrypting"} ${data.remaining} transactions…`);
        const convert = (v: string | null) => {
          if (!v) return v;
          if (direction === "encrypt") return isEncrypted(v) ? v : encryptField(platform, key, familyId, v);
          return isEncrypted(v) ? decryptField(key, familyId, v) : v;
        };
        await api.post(`/families/${familyId}/encryption/bulk`, {
          // Repeating payments carry payee/notes too; `kind` tells the server which table.
          items: data.items.map((t) => ({ id: t.id, kind: t.kind, payee: convert(t.payee), notes: convert(t.notes) })),
        });
      }
      setProgress(null);
    },
    [familyId]
  );

  const afterUnlock = useCallback(
    async (privateKey: Uint8Array) => {
      privateKeyRef.current = privateKey;
      const state = await loadFamilyEncryption();
      if (state?.wrappedKey && familyId) {
        const familyKey = openFamilyKey(state.wrappedKey, privateKey);
        familyKeyRef.current = familyKey;
        setFamilyKey(familyId, familyKey);

        // Share the key with members who have set up a vault since it was last distributed.
        const pending = state.members.filter((m) => m.publicKey && !m.hasKey);
        if (pending.length > 0) {
          await api
            .post(`/families/${familyId}/encryption/grant`, {
              wrappedKeys: pending.map((m) => ({ userId: m.userId, wrappedKey: sealFamilyKey(platform, familyKey, m.publicKey!) })),
            })
            .then(loadFamilyEncryption)
            .catch(() => undefined);
        }
        // Finish an interrupted "encrypt existing transactions" pass.
        if (state.enabled && isAdmin) convertAll("encrypt", familyKey).catch(() => setProgress(null));
      }
      setStatus("unlocked");
    },
    [familyId, isAdmin, loadFamilyEncryption, convertAll]
  );

  // ---- vault lifecycle ---------------------------------------------------------------------
  const setupVault = useCallback(
    async (masterPassword: string) => {
      const { record, privateKey } = await createVault(platform, masterPassword);
      await api.put("/auth/vault", record);
      setVault(record);
      await afterUnlock(privateKey);
      await refreshUser();
    },
    [afterUnlock, refreshUser]
  );

  const unlock = useCallback(
    async (masterPassword: string) => {
      if (!vault) throw new ClientError("No vault to unlock");
      let privateKey: Uint8Array;
      try {
        privateKey = await openVault(platform, vault, masterPassword);
      } catch (err) {
        throw new ClientError(err instanceof Error ? err.message : "Unable to unlock");
      }
      await afterUnlock(privateKey);
    },
    [vault, afterUnlock]
  );

  const changeMasterPassword = useCallback(
    async (current: string, next: string) => {
      if (!vault) throw new ClientError("No vault");
      let privateKey: Uint8Array;
      try {
        privateKey = await openVault(platform, vault, current);
      } catch {
        throw new ClientError("Current master password is incorrect");
      }
      const record = await rewrapVault(platform, vault, privateKey, next);
      await api.put("/auth/vault", record);
      setVault(record);
    },
    [vault]
  );

  const resetVault = useCallback(
    async (newMasterPassword: string) => {
      // New key pair: anything sealed to the old one is unrecoverable by this user until another
      // member re-shares the family key (which happens automatically on their next unlock).
      const { record, privateKey } = await createVault(platform, newMasterPassword);
      await api.put("/auth/vault", record);
      if (easyKey) storageSet(easyKey, null);
      setEasyUnlockEnabled(false);
      if (familyId) setFamilyKey(familyId, null);
      familyKeyRef.current = null;
      setVault(record);
      await afterUnlock(privateKey);
    },
    [afterUnlock, easyKey, familyId]
  );

  const removeVault = useCallback(async () => {
    if (familyEncrypted) throw new ClientError("Turn off family encryption before removing your master password");
    await api.delete("/auth/vault");
    if (easyKey) storageSet(easyKey, null);
    setEasyUnlockEnabled(false);
    privateKeyRef.current = null;
    setVault(null);
    setStatus("none");
    await refreshUser();
  }, [familyEncrypted, easyKey, refreshUser]);

  const enableFamilyEncryption = useCallback(async () => {
    if (!familyId || !vault || !privateKeyRef.current || !user) throw new ClientError("Unlock your vault first");
    const state = await loadFamilyEncryption();
    const familyKey = newFamilyKey(platform);
    const recipients = (state?.members ?? []).filter((m) => m.publicKey);
    if (!recipients.some((m) => m.userId === user.id)) recipients.push({ userId: user.id, name: user.name, publicKey: vault.publicKey, hasKey: false });

    await api.post(`/families/${familyId}/encryption/enable`, {
      wrappedKeys: recipients.map((m) => ({ userId: m.userId, wrappedKey: sealFamilyKey(platform, familyKey, m.publicKey!) })),
    });
    familyKeyRef.current = familyKey;
    setFamilyKey(familyId, familyKey);
    setFamilyEncrypted(familyId, true);
    try {
      await convertAll("encrypt", familyKey);
    } finally {
      setProgress(null);
      await loadFamilyEncryption();
      await refreshUser();
    }
  }, [familyId, vault, user, loadFamilyEncryption, convertAll, refreshUser]);

  const disableFamilyEncryption = useCallback(async () => {
    if (!familyId || !familyKeyRef.current) throw new ClientError("Unlock your vault first");
    try {
      await convertAll("decrypt", familyKeyRef.current);
      await api.post(`/families/${familyId}/encryption/disable`);
    } finally {
      setProgress(null);
    }
    familyKeyRef.current = null;
    setFamilyKey(familyId, null);
    setFamilyEncrypted(familyId, false);
    await loadFamilyEncryption();
    await refreshUser();
  }, [familyId, convertAll, loadFamilyEncryption, refreshUser]);

  // ---- easy unlock + screen lock (passkey based) ------------------------------------------
  const enableEasyUnlock = useCallback(async () => {
    if (!easyKey || !privateKeyRef.current) throw new ClientError("Unlock your vault first");
    const salt = platform.randomBytes(32);
    const { credentialId, prfOutput } = await verifyWithPasskey({ prfSalt: salt });
    if (!prfOutput) {
      throw new ClientError(
        "This browser or passkey can't derive an encryption key (WebAuthn PRF). Try a passkey saved in Chrome, Edge, or your phone."
      );
    }
    const record: EasyUnlockRecord = { credentialId, salt: toBase64(salt), wrapped: wrapWithSecret(platform, prfOutput, privateKeyRef.current) };
    storageSet(easyKey, JSON.stringify(record));
    setEasyUnlockEnabled(true);
  }, [easyKey]);

  const disableEasyUnlock = useCallback(() => {
    if (easyKey) storageSet(easyKey, null);
    setEasyUnlockEnabled(false);
  }, [easyKey]);

  const unlockWithPasskey = useCallback(async () => {
    const raw = easyKey ? storageGet(easyKey) : null;
    const easy: EasyUnlockRecord | null = raw ? JSON.parse(raw) : null;

    if (easy && status === "locked") {
      const { prfOutput } = await verifyWithPasskey({ prfSalt: fromBase64(easy.salt), credentialId: easy.credentialId });
      if (!prfOutput) throw new ClientError("Your passkey didn't return a key. Use your master password instead.");
      let privateKey: Uint8Array;
      try {
        privateKey = unwrapWithSecret(prfOutput, easy.wrapped);
      } catch {
        disableEasyUnlock();
        throw new ClientError("Easy unlock is out of date on this device. Use your master password.");
      }
      await afterUnlock(privateKey);
    } else {
      await verifyWithPasskey();
    }
    setScreenLocked(false);
  }, [easyKey, status, afterUnlock, disableEasyUnlock]);

  const enableScreenLock = useCallback(async () => {
    if (!screenKey) return;
    await verifyWithPasskey(); // proves a working passkey exists before we lock anyone out
    storageSet(screenKey, "1");
    setScreenLockEnabled(true);
  }, [screenKey]);

  const disableScreenLock = useCallback(() => {
    if (screenKey) storageSet(screenKey, null);
    setScreenLockEnabled(false);
    setScreenLocked(false);
  }, [screenKey]);

  const value = useMemo<SecurityContextValue>(
    () => ({
      status,
      awaitingAccess: status === "unlocked" && !!familyEncryption?.enabled && !familyEncryption.wrappedKey,
      familyEncryption,
      progress,
      setupSkipped,
      skipSetup: () => setSetupSkipped(true),
      setupVault,
      unlock,
      changeMasterPassword,
      resetVault,
      removeVault,
      enableFamilyEncryption,
      disableFamilyEncryption,
      easyUnlockEnabled,
      enableEasyUnlock,
      disableEasyUnlock,
      screenLockEnabled,
      screenLocked,
      enableScreenLock,
      disableScreenLock,
      unlockWithPasskey,
    }),
    [
      status,
      familyEncryption,
      progress,
      setupSkipped,
      setupVault,
      unlock,
      changeMasterPassword,
      resetVault,
      removeVault,
      enableFamilyEncryption,
      disableFamilyEncryption,
      easyUnlockEnabled,
      enableEasyUnlock,
      disableEasyUnlock,
      screenLockEnabled,
      screenLocked,
      enableScreenLock,
      disableScreenLock,
      unlockWithPasskey,
    ]
  );

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error("useSecurity must be used within SecurityProvider");
  return ctx;
}
