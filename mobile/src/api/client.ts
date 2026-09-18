import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import {
  getAccessToken,
  getStoredRefreshToken,
  setAccessToken,
  setStoredRefreshToken,
} from "./tokenStore";

// The built APK ships pointed at the production deployment. `EXPO_PUBLIC_API_URL` overrides it
// for local development (e.g. `EXPO_PUBLIC_API_URL=http://localhost:4000/api expo start`, with
// `adb reverse tcp:4000 tcp:4000` for a physical device or emulator reaching the dev machine).
const DEFAULT_API_URL = "https://family-finance.vercel.app/api";
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_API_URL;

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
