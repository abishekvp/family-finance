import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { getAccessToken, notifyAuthExpired, setAccessToken } from "./tokenStore";
import { decryptIncoming, encryptOutgoing } from "./vaultSession";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

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

// Transactions and repeating payments both carry end-to-end encrypted payee/notes.
const TRANSACTIONS_URL = /\/families\/([^/]+)\/(?:transactions|recurring)(?:\/|$|\?)/;

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    // Held across tabs, so tabs sharing the refresh cookie rotate it one at a time instead of racing
    // and presenting a token another tab just rotated away.
    const post = () => axios.post("/api/auth/refresh", null, { withCredentials: true });
    refreshPromise = (async () =>
      typeof navigator !== "undefined" && navigator.locks ? await navigator.locks.request("auth-refresh", post) : await post())()
      .then((res) => {
        const token = res.data.accessToken as string;
        setAccessToken(token);
        return token;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => {
    if (response.config.url?.match(TRANSACTIONS_URL)) decryptIncoming(response.data);
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
      notifyAuthExpired();
    }

    return Promise.reject(error);
  }
);

export { refreshAccessToken };
