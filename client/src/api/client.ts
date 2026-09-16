import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { getAccessToken, notifyAuthExpired, setAccessToken } from "./tokenStore";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

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
    refreshPromise = axios
      .post("/api/auth/refresh", null, { withCredentials: true })
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
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuthRoute = originalRequest?.url?.includes("/auth/login") || originalRequest?.url?.includes("/auth/register");

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
