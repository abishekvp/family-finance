import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Chrome/Edge fire `beforeinstallprompt` once, before we have a component mounted that cares
 * about it. This provider captures the event at app start and hands it to whatever UI wants
 * to trigger the native install flow later (the Get the app page, the header hint).
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "android" | "ios" | "desktop";

interface InstallContextValue {
  /** True when the browser has offered us a native install prompt we can still fire. */
  canPrompt: boolean;
  /** True when the app is already running from the home screen / as a standalone window. */
  isInstalled: boolean;
  platform: Platform;
  /** Fires the native prompt. Resolves to true when the user accepted. */
  promptInstall: () => Promise<boolean>;
}

const InstallContext = createContext<InstallContextValue | undefined>(undefined);

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPadOS 13+ reports as a Mac; the touch-point check separates it from a real desktop.
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  return "desktop";
}

function detectStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's non-standard flag, still the only signal on iOS.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function InstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(detectStandalone);
  const platform = useMemo(detectPlatform, []);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const media = window.matchMedia("(display-mode: standalone)");
    const onDisplayModeChange = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    media.addEventListener("change", onDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      media.removeEventListener("change", onDisplayModeChange);
    };
  }, []);

  const value = useMemo<InstallContextValue>(
    () => ({
      canPrompt: deferred !== null,
      isInstalled,
      platform,
      promptInstall: async () => {
        if (!deferred) return false;
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        // The event is single-use — drop it either way so the button stops offering.
        setDeferred(null);
        return outcome === "accepted";
      },
    }),
    [deferred, isInstalled, platform]
  );

  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export function useInstall() {
  const ctx = useContext(InstallContext);
  if (!ctx) throw new Error("useInstall must be used within InstallProvider");
  return ctx;
}
