import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL, api, refreshAccessToken, setOnAuthExpired, wasSessionRejected } from "../api/client";
import { ClientError } from "../api/errors";
import { getStoredRefreshToken, setAccessToken, setStoredRefreshToken } from "../api/tokenStore";
import { clearVaultSession } from "../api/vaultSession";
import { clearTodayWidget } from "../lib/todayWidget";
import { clearTransactionCache } from "../lib/transactionStore";
import { unregisterBackgroundSync } from "../lib/backgroundSync";

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
  /** Signed in on this phone, but the server couldn't be reached to open the session. */
  offline: boolean;
  /** Tries to reach the server again after `offline`. */
  retry: () => Promise<void>;
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

// The signed-in profile, kept on the device so a cold start opens straight into the app (and stays
// there offline) instead of waiting on the network — or worse, landing on the sign-in screen
// because the phone had no signal at that moment.
function profileFile() {
  return new File(Paths.document, "session-user.json");
}

function isCurrentUser(data: unknown): data is CurrentUser {
  const u = data as CurrentUser | null;
  return typeof u === "object" && u !== null && typeof u.id === "string" && Array.isArray(u.families);
}

function readCachedUser(): CurrentUser | null {
  try {
    const file = profileFile();
    if (!file.exists) return null;
    const data: unknown = JSON.parse(file.textSync());
    return isCurrentUser(data) ? data : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: CurrentUser | null) {
  try {
    const file = profileFile();
    if (!user) {
      if (file.exists) file.delete();
      return;
    }
    if (!file.exists) file.create();
    file.write(JSON.stringify(user));
  } catch {
    // Only a cache: the next launch waits for the server instead.
  }
}

async function hasStoredSession() {
  try {
    return !!(await getStoredRefreshToken());
  } catch {
    // Keystore hiccup: assume the session is still there; the refresh decides for real.
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  // Whether `user` has been confirmed by the server this launch (rather than read from the device).
  const verified = useRef(false);

  const loadMe = useCallback(async () => {
    const res = await api.get<CurrentUser>("/auth/me");
    // A captive Wi-Fi portal or a proxy can answer 200 with an HTML page. Taking that as the user
    // would crash every screen that reads user.families, so treat it like being offline.
    if (!isCurrentUser(res.data)) throw new ClientError("Unexpected response from the server");
    verified.current = true;
    writeCachedUser(res.data);
    setOffline(false);
    setUser(res.data);
  }, []);

  const refreshUser = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  /** Wipes everything this device holds for the session. */
  const endSession = useCallback(() => {
    verified.current = false;
    setAccessToken(null);
    writeCachedUser(null);
    clearVaultSession();
    clearTodayWidget();
    clearTransactionCache();
    unregisterBackgroundSync().catch(() => undefined);
    setOffline(false);
    setUser(null);
  }, []);

  // Opens the stored session with the server. A rejection signs out; anything else (no signal, a
  // timeout, a server hiccup) keeps the user signed in and is retried on the next return to the app.
  const restoringRef = useRef<Promise<void> | null>(null);
  const restore = useCallback(() => {
    if (!restoringRef.current) {
      restoringRef.current = (async () => {
        const token = await refreshAccessToken().catch(() => null);
        if (!token) {
          if (wasSessionRejected()) endSession();
          else setOffline(true);
          return;
        }
        try {
          await loadMe();
        } catch {
          // The interceptor has already signed out if the server rejected the session.
          if (!wasSessionRejected()) setOffline(true);
        }
      })().finally(() => {
        restoringRef.current = null;
      });
    }
    return restoringRef.current;
  }, [endSession, loadMe]);

  useEffect(() => {
    setOnAuthExpired(endSession);

    (async () => {
      try {
        if (!(await hasStoredSession())) {
          endSession();
          return;
        }
        // Show the app straight away from the copy on the device; the server confirms it behind.
        const cached = readCachedUser();
        if (cached) {
          setUser(cached);
          setIsLoading(false);
        }
        await restore();
      } finally {
        setIsLoading(false);
      }
    })();

    return () => setOnAuthExpired(null);
  }, [endSession, restore]);

  // Couldn't reach the server at launch: try again whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && !verified.current && !isLoading) {
        hasStoredSession().then((stored) => {
          if (stored) restore();
        });
      }
    });
    return () => sub.remove();
  }, [isLoading, restore]);

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
    const refreshToken = await getStoredRefreshToken().catch(() => null);
    await setStoredRefreshToken(null).catch(() => undefined);
    endSession();
    // Sign out on this phone first, then tell the server — without making the user wait on it.
    if (refreshToken) api.post("/auth/logout", { refreshToken }, { timeout: 10_000 }).catch(() => undefined);
  }, [endSession]);

  const value = useMemo(
    () => ({ user, isLoading, offline, retry: restore, login, register, completeSignIn, signInWithOAuth, logout, refreshUser }),
    [user, isLoading, offline, restore, login, register, completeSignIn, signInWithOAuth, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
