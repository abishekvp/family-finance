import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  getAccessToken,
  getStoredRefreshToken,
  setAccessToken,
  setStoredRefreshToken,
} from "./tokenStore";
import { decryptIncoming, encryptOutgoing } from "./vaultSession";

// The built APK ships pointed at the production deployment. `EXPO_PUBLIC_API_URL` overrides it
// for local development (e.g. `EXPO_PUBLIC_API_URL=http://localhost:4000/api expo start`, with
// `adb reverse tcp:4000 tcp:4000` for a physical device or emulator reaching the dev machine).
const DEFAULT_API_URL = "https://finance.abishek.in/api";
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_URL;

export const api = axios.create({ baseURL: API_BASE_URL });

let onAuthExpired: (() => void) | null = null;
export function setOnAuthExpired(handler: (() => void) | null) {
  onAuthExpired = handler;
}

// Transactions and repeating payments both carry payee/notes, which are end-to-end encrypted.
const TRANSACTIONS_URL = /\/families\/([^/]+)\/(?:transactions|recurring)(?:\/|$|\?)/;
// The sync feed is kept on the device still sealed, and decrypted only when read (transactionStore).
const SYNC_URL = /\/families\/[^/]+\/transactions\/sync(?:$|\?)/;
const TRANSACTION_WRITE_URL = /\/families\/([^/]+)\/transactions(?:\/([^/?]+))?(?:$|\?)/;

/** A transaction as the server saved it (payee/notes still sealed), or the id of one deleted. */
export type TransactionWrite = { familyId: string } & ({ saved: Record<string, unknown> } | { deletedId: string });
const transactionWriteListeners = new Set<(write: TransactionWrite) => void>();

/** Lets the local transaction copy pick up this device's own saves without waiting for a sync. */
export function onTransactionWrite(listener: (write: TransactionWrite) => void) {
  transactionWriteListeners.add(listener);
  return () => {
    transactionWriteListeners.delete(listener);
  };
}

function reportTransactionWrite(method: string | undefined, url: string | undefined, data: unknown) {
  const match = url?.match(TRANSACTION_WRITE_URL);
  if (!match || match[2] === "sync") return;
  const m = method?.toLowerCase();
  let write: TransactionWrite | null = null;
  if ((m === "post" || m === "patch") && data && typeof data === "object" && "id" in data) {
    write = { familyId: match[1], saved: { ...(data as Record<string, unknown>) } };
  } else if (m === "delete" && match[2]) {
    write = { familyId: match[1], deletedId: match[2] };
  }
  if (write) transactionWriteListeners.forEach((l) => l(write));
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  // End-to-end encryption: payee/notes are sealed with the family key before they leave the device.
  const match = config.url?.match(TRANSACTIONS_URL);
  const method = config.method?.toLowerCase();
  if (match && (method === "post" || method === "patch") && config.data && typeof config.data === "object") {
    config.data = encryptOutgoing(match[1], config.data as Record<string, unknown>);
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;
// True only when the server definitively rejected the session (or none is stored) — as opposed to
// the refresh failing for a transient reason (offline, timeout, 5xx) where the user is still signed in.
let sessionRejected = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      sessionRejected = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const storedRefreshToken = await getStoredRefreshToken();
        if (!storedRefreshToken) {
          sessionRejected = true;
          return null;
        }

        try {
          const res = await axios.post(
            `${API_BASE_URL}/auth/refresh`,
            { refreshToken: storedRefreshToken },
            { timeout: 15_000 }
          );
          const { accessToken, refreshToken } = res.data as { accessToken: string; refreshToken: string };
          setAccessToken(accessToken);
          await setStoredRefreshToken(refreshToken);
          return accessToken;
        } catch (err) {
          const status = axios.isAxiosError(err) ? err.response?.status : undefined;
          if (status === 401 || status === 403) {
            // The background sync / SMS task run in their own JS context and may have rotated the
            // token under us. If the stored token changed, that's not a rejection — retry with it.
            if ((await getStoredRefreshToken()) !== storedRefreshToken) continue;
            sessionRejected = true;
            setAccessToken(null);
            await setStoredRefreshToken(null);
            return null;
          }
          // Network error, timeout or 5xx: keep the stored token and back off before retrying.
          if (attempt < 2) await sleep(1000 * (attempt + 1));
        }
      }
      return null;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/** Whether the last failed refresh was the server rejecting the session, not a connectivity blip. */
export function wasSessionRejected() {
  return sessionRejected;
}

api.interceptors.response.use(
  (response) => {
    const url = response.config.url;
    if (url?.match(TRANSACTIONS_URL) && !url.match(SYNC_URL)) {
      // Before decrypting: the local copy keeps what the server holds.
      reportTransactionWrite(response.config.method, url, response.data);
      decryptIncoming(response.data);
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthRoute = /\/auth\/(login|register|password|passkeys\/login|oauth)/.test(originalRequest?.url ?? "");

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.set("Authorization", `Bearer ${newToken}`);
        return api(originalRequest);
      }
      if (sessionRejected) onAuthExpired?.();
    }

    return Promise.reject(error);
  }
);

export { refreshAccessToken };
