import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL, api, refreshAccessToken, setOnAuthExpired } from "../api/client";
import { ClientError } from "../api/errors";
import { getStoredRefreshToken, setAccessToken, setStoredRefreshToken } from "../api/tokenStore";
import { clearVaultSession } from "../api/vaultSession";
import { clearTodayWidget } from "../lib/todayWidget";

/** Preferences shared with the web app (see server /auth/me/preferences). */
export interface ServerPrefs {
  defaultView: "daily" | "calendar";
  weekStart: "sunday" | "monday";
  carryOver: boolean;
}

export type OAuthProvider = "google" | "microsoft";
const OAUTH_REDIRECT = "familyfinance://oauth-callback";

export interface FamilySummary {
  id: string;
  name: string;
  currency: string;
  encryptionEnabled: boolean;
  role: "ADMIN" | "MEMBER" | "VIEWER";
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  hasPassword: boolean;
  hasVault: boolean;
  preferences: ServerPrefs;
  families: FamilySummary[];
}

interface AuthContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  /** Finishes any sign-in flow that produced tokens (passkey, password reset). */
  completeSignIn: (accessToken: string, refreshToken: string) => Promise<void>;
  /** Runs the Google/Microsoft flow in a browser tab. Resolves false if the user cancelled. */
  signInWithOAuth: (provider: OAuthProvider) => Promise<boolean>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const res = await api.get<CurrentUser>("/auth/me");
    setUser(res.data);
  }, []);

  const refreshUser = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  useEffect(() => {
    setOnAuthExpired(() => {
      clearTodayWidget();
      setUser(null);
    });

    (async () => {
      const token = await refreshAccessToken();
      if (token) {
        try {
          await loadMe();
        } catch {
          setUser(null);
        }
      } else {
        clearTodayWidget();
      }
      setIsLoading(false);
    })();

    return () => setOnAuthExpired(null);
  }, [loadMe]);

  const applySession = useCallback(async (accessToken: string, refreshToken: string) => {
    setAccessToken(accessToken);
    await setStoredRefreshToken(refreshToken);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post("/auth/login", { email, password });
      await applySession(res.data.accessToken, res.data.refreshToken);
      await loadMe();
    },
    [applySession, loadMe]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api.post("/auth/register", { name, email, password });
      await applySession(res.data.accessToken, res.data.refreshToken);
      await loadMe();
    },
    [applySession, loadMe]
  );

  const completeSignIn = useCallback(
    async (accessToken: string, refreshToken: string) => {
      await applySession(accessToken, refreshToken);
      await loadMe();
    },
    [applySession, loadMe]
  );

  const signInWithOAuth = useCallback(
    async (provider: OAuthProvider) => {
      // The server runs the whole OAuth round trip and bounces back to our scheme with a one-time code.
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_BASE_URL}/auth/oauth/${provider}/start?platform=mobile`,
        OAUTH_REDIRECT
      );
      if (result.type !== "success") return false;
      const { queryParams } = Linking.parse(result.url);
      const error = queryParams?.error;
      if (typeof error === "string") throw new ClientError(error);
      const code = queryParams?.code;
      if (typeof code !== "string") throw new ClientError("Sign-in didn't complete. Please try again.");
      const res = await api.post("/auth/oauth/exchange", { code });
      await completeSignIn(res.data.accessToken, res.data.refreshToken);
      return true;
    },
    [completeSignIn]
  );

  const logout = useCallback(async () => {
    const refreshToken = await getStoredRefreshToken();
    await api.post("/auth/logout", { refreshToken }).catch(() => undefined);
    setAccessToken(null);
    await setStoredRefreshToken(null);
    clearVaultSession();
    clearTodayWidget();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, completeSignIn, signInWithOAuth, logout, refreshUser }),
    [user, isLoading, login, register, completeSignIn, signInWithOAuth, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
