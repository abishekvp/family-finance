import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshAccessToken } from "../api/client";
import { setAccessToken, setOnAuthExpired } from "../api/tokenStore";
import { clearVaultSession } from "../api/vaultSession";
import { applyServerPrefs, type ServerPrefs } from "../lib/prefs";

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
  /** Finishes any sign-in flow that produced an access token (passkey, password reset). */
  completeSignIn: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const res = await api.get<CurrentUser>("/auth/me");
    applyServerPrefs(res.data.preferences);
    setUser(res.data);
  }, []);

  const refreshUser = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  useEffect(() => {
    setOnAuthExpired(() => setUser(null));

    (async () => {
      const token = await refreshAccessToken();
      if (token) {
        try {
          await loadMe();
        } catch {
          setUser(null);
        }
      }
      setIsLoading(false);
    })();

    return () => setOnAuthExpired(null);
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post("/auth/login", { email, password });
      setAccessToken(res.data.accessToken);
      await loadMe();
    },
    [loadMe]
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api.post("/auth/register", { name, email, password });
      setAccessToken(res.data.accessToken);
      await loadMe();
    },
    [loadMe]
  );

  const completeSignIn = useCallback(
    async (accessToken: string) => {
      setAccessToken(accessToken);
      await loadMe();
    },
    [loadMe]
  );

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setAccessToken(null);
    clearVaultSession();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, login, register, completeSignIn, logout, refreshUser }),
    [user, isLoading, login, register, completeSignIn, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
