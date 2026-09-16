/**
 * Registers the offline shell worker.
 *
 * Deliberately not registered in dev: a cached shell fights Vite's HMR and makes edits look
 * like they did not apply. `updateViaCache: "none"` keeps the browser from serving a stale
 * copy of sw.js itself, which is the usual reason a PWA gets stuck on an old build.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        // Pick up a new deployment as soon as the tab is focused again.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {
        // An unavailable worker only costs offline support — never block the app on it.
      });
  });
}
