import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { api } from "../api/client";
import { ClientError } from "../api/errors";
import { setFamilyEncrypted, setFamilyKey } from "../api/vaultSession";
import { useAuth } from "./AuthContext";
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

export interface FamilyEncryptionState {
  enabled: boolean;
  wrappedKey: string | null;
  members: EncryptionMember[];
}

interface SecurityContextValue {
  status: VaultStatus;
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
  /** Vault key kept in the Android Keystore behind biometrics, so no master password is typed. */
  easyUnlockEnabled: boolean;
  enableEasyUnlock: () => Promise<void>;
  disableEasyUnlock: () => Promise<void>;
  /** Device screen lock (fingerprint / face / PIN / pattern) on open and after time away. */
  appLockEnabled: boolean;
  appLocked: boolean;
  enableAppLock: () => Promise<void>;
  disableAppLock: () => Promise<void>;
  /** Biometric/device-credential unlock: clears the app lock and, with easy unlock, the vault. */
  unlockWithDevice: () => Promise<void>;
}

const SecurityContext = createContext<SecurityContextValue | undefined>(undefined);

const APP_LOCK_AFTER_MS = 60 * 1000;

// SecureStore keys may only contain [A-Za-z0-9._-] (user ids are cuids, so they qualify).
const appLockKey = (userId: string) => `familyFinance.appLock.${userId}`;
const easyFlagKey = (userId: string) => `familyFinance.easyUnlock.${userId}`;
const easySecretKey = (userId: string) => `familyFinance.vaultKey.${userId}`;

async function deviceAuthenticate(promptMessage: string) {
  const result = await LocalAuthentication.authenticateAsync({ promptMessage, cancelLabel: "Cancel" });
  if (!result.success) {
    throw new ClientError(result.error === "user_cancel" || result.error === "system_cancel" ? "Unlock was cancelled" : "Couldn't verify it's you");
  }
}

export function SecurityProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth();
  const family = user?.families[0];
  const familyId = family?.id;
  const isAdmin = family?.role === "ADMIN";
  const userId = user?.id;
  const familyEncrypted = family?.encryptionEnabled ?? false;

  const [status, setStatus] = useState<VaultStatus>("loading");
  const [vault, setVault] = useState<VaultRecord | null>(null);
  const [familyEncryption, setFamilyEncryption] = useState<FamilyEncryptionState | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [easyUnlockEnabled, setEasyUnlockEnabled] = useState(false);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [appLocked, setAppLocked] = useState(false);
  const privateKeyRef = useRef<Uint8Array | null>(null);
  const familyKeyRef = useRef<Uint8Array | null>(null);
  // Set when /auth/vault couldn't be reached at sign-in, so whether a vault exists is unknown.
  const vaultCheckFailed = useRef(false);

  // ---- load on sign-in ---------------------------------------------------------------------
  useEffect(() => {
    privateKeyRef.current = null;
    familyKeyRef.current = null;
    setFamilyEncryption(null);
    setSetupSkipped(false);
    if (!userId) {
      setStatus("loading");
      setVault(null);
      setAppLocked(false);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    (async () => {
      const [lockFlag, easyFlag] = await Promise.all([
        SecureStore.getItemAsync(appLockKey(userId)).catch(() => null),
        SecureStore.getItemAsync(easyFlagKey(userId)).catch(() => null),
      ]);
      if (cancelled) return;
      setAppLockEnabled(lockFlag === "1");
      setAppLocked(lockFlag === "1");
      setEasyUnlockEnabled(easyFlag === "1");
      try {
        const { data } = await api.get<{ vault: VaultRecord | null }>("/auth/vault");
        if (cancelled) return;
        vaultCheckFailed.current = false;
        setVault(data.vault);
        setStatus(data.vault ? "locked" : familyEncrypted ? "setup" : "none");
      } catch {
        // Offline at launch: let the app open (payees/notes show as locked) and look again when
        // the app next comes to the foreground, below.
        if (cancelled) return;
        vaultCheckFailed.current = true;
        setStatus("none");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run for a different account — not on every /auth/me refresh.
  }, [userId]);

  // The vault couldn't be checked at launch: try again on return to the app, and ask for the
  // master password then if there is one.
  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !vaultCheckFailed.current) return;
      api
        .get<{ vault: VaultRecord | null }>("/auth/vault")
        .then(({ data }) => {
          vaultCheckFailed.current = false;
          setVault(data.vault);
          setStatus((current) => (current !== "none" ? current : data.vault ? "locked" : familyEncrypted ? "setup" : "none"));
        })
        .catch(() => undefined);
    });
    return () => sub.remove();
  }, [userId, familyEncrypted]);

  useEffect(() => {
    if (familyId) setFamilyEncrypted(familyId, familyEncrypted);
  }, [familyId, familyEncrypted]);

  // Re-lock after the app has been in the background for a while.
  useEffect(() => {
    if (!appLockEnabled) return;
    let backgroundedAt = 0;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundedAt = Date.now();
      else if (state === "active" && backgroundedAt && Date.now() - backgroundedAt > APP_LOCK_AFTER_MS) {
        setAppLocked(true);
      }
    });
    return () => sub.remove();
  }, [appLockEnabled]);

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

  const disableEasyUnlock = useCallback(async () => {
    if (!userId) return;
    await SecureStore.deleteItemAsync(easySecretKey(userId)).catch(() => undefined);
    await SecureStore.deleteItemAsync(easyFlagKey(userId)).catch(() => undefined);
    setEasyUnlockEnabled(false);
  }, [userId]);

  const resetVault = useCallback(
    async (newMasterPassword: string) => {
      const { record, privateKey } = await createVault(platform, newMasterPassword);
      await api.put("/auth/vault", record);
      await disableEasyUnlock();
      if (familyId) setFamilyKey(familyId, null);
      familyKeyRef.current = null;
      setVault(record);
      await afterUnlock(privateKey);
    },
    [afterUnlock, disableEasyUnlock, familyId]
  );

  const removeVault = useCallback(async () => {
    if (familyEncrypted) throw new ClientError("Turn off family encryption before removing your master password");
    await api.delete("/auth/vault");
    await disableEasyUnlock();
    privateKeyRef.current = null;
    setVault(null);
    setStatus("none");
    await refreshUser();
  }, [familyEncrypted, disableEasyUnlock, refreshUser]);

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

  // ---- device unlock -----------------------------------------------------------------------
  const enableEasyUnlock = useCallback(async () => {
    if (!userId || !privateKeyRef.current) throw new ClientError("Unlock your vault first");
    if (!SecureStore.canUseBiometricAuthentication()) {
      throw new ClientError("Set up a fingerprint or face unlock on this phone first");
    }
    await SecureStore.setItemAsync(easySecretKey(userId), toBase64(privateKeyRef.current), {
      requireAuthentication: true,
      authenticationPrompt: "Enable easy unlock",
    });
    await SecureStore.setItemAsync(easyFlagKey(userId), "1");
    setEasyUnlockEnabled(true);
  }, [userId]);

  const enableAppLock = useCallback(async () => {
    if (!userId) return;
    // SECRET (PIN/pattern/password) or any biometric level is enough — it's the phone's own lock.
    if ((await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.NONE) {
      throw new ClientError("Set a screen lock (PIN, pattern or biometrics) on this phone first");
    }
    await deviceAuthenticate("Turn on app lock");
    await SecureStore.setItemAsync(appLockKey(userId), "1");
    setAppLockEnabled(true);
  }, [userId]);

  const disableAppLock = useCallback(async () => {
    if (!userId) return;
    await SecureStore.deleteItemAsync(appLockKey(userId)).catch(() => undefined);
    setAppLockEnabled(false);
    setAppLocked(false);
  }, [userId]);

  const unlockWithDevice = useCallback(async () => {
    if (userId && easyUnlockEnabled && status === "locked") {
      let secret: string | null;
      try {
        // Reading an auth-bound item shows the biometric prompt itself — one prompt unlocks both.
        secret = await SecureStore.getItemAsync(easySecretKey(userId), {
          requireAuthentication: true,
          authenticationPrompt: "Unlock Family Finance",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (/cancel/i.test(message)) throw new ClientError("Unlock was cancelled");
        // A new fingerprint/face enrolment invalidates Keystore keys — fall back to the password.
        await disableEasyUnlock();
        throw new ClientError("Easy unlock needs to be set up again. Use your master password.");
      }
      if (!secret) {
        await disableEasyUnlock();
        throw new ClientError("Easy unlock needs to be set up again. Use your master password.");
      }
      await afterUnlock(fromBase64(secret));
    } else {
      await deviceAuthenticate("Unlock Family Finance");
    }
    setAppLocked(false);
  }, [userId, easyUnlockEnabled, status, afterUnlock, disableEasyUnlock]);

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
      appLockEnabled,
      appLocked,
      enableAppLock,
      disableAppLock,
      unlockWithDevice,
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
      appLockEnabled,
      appLocked,
      enableAppLock,
      disableAppLock,
      unlockWithDevice,
    ]
  );

  return <SecurityContext.Provider value={value}>{children}</SecurityContext.Provider>;
}

export function useSecurity() {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error("useSecurity must be used within SecurityProvider");
  return ctx;
}
