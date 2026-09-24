import { launchedFromHistory } from "../modules/home-widgets";

/**
 * Android reopens an app from Recents with the intent that first started it. When that was a
 * home-screen quick add, the app would land on the add form again — possibly days later — and
 * saving there sends the app back to the background. Open the app normally instead.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  if (initial && path.includes("source=widget") && launchedFromHistory()) return "/";
  return path;
}
