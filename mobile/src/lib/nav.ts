import type { Href } from "expo-router";

/**
 * Builds an expo-router Href for an internal route by plain string path.
 *
 * Expo Router's "typedRoutes" experiment checks `router.push`/`Link` targets against a
 * generated `.expo/types/router.d.ts` file that is only regenerated while the dev server or a
 * build runs. This project's copy predates several routes added in this pass (stats, accounts,
 * more, settings, categories, budgets, transaction-form), so a plain string literal for those
 * routes doesn't structurally match the stale generated union. The cast is a deliberate,
 * narrowly-scoped escape hatch — every route referenced here is a real file under app/(app)/.
 */
export function href(pathname: string, params?: Record<string, string>): Href {
  return (params ? { pathname, params } : pathname) as unknown as Href;
}
