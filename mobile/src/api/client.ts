import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  getAccessToken,
  getStoredRefreshToken,
  setAccessToken,
  setStoredRefreshToken,
} from "./tokenStore";

// The Android emulator/device reaches the dev machine's backend via `adb reverse tcp:4000 tcp:4000`,
// which makes the device's own localhost:4000 forward to the host's localhost:4000.
const API_BASE_URL = "http://localhost:4000/api";

export const api = axios.create({ baseURL: API_BASE_URL });

let onAuthExpired: (() => void) | null = null;
export function setOnAuthExpired(handler: (() => void) | null) {
  onAuthExpired = handler;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const storedRefreshToken = await getStoredRefreshToken();
      if (!storedRefreshToken) return null;

      try {
        const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken: storedRefreshToken,
        });
        const { accessToken, refreshToken } = res.data as { accessToken: string; refreshToken: string };
        setAccessToken(accessToken);
        await setStoredRefreshToken(refreshToken);
        return accessToken;
      } catch {
        setAccessToken(null);
        await setStoredRefreshToken(null);
        return null;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthRoute =
      originalRequest?.url?.includes("/auth/login") || originalRequest?.url?.includes("/auth/register");

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;
      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.set("Authorization", `Bearer ${newToken}`);
        return api(originalRequest);
      }
      onAuthExpired?.();
    }

    return Promise.reject(error);
  }
);

export { refreshAccessToken };
