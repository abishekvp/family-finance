import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import type { FamilySummary } from "../context/AuthContext";

export type Scope = "family" | "personal";

export interface LayoutContext {
  family: FamilySummary;
  scope: Scope;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", enabled: true },
  { to: "/transactions", label: "Transactions", enabled: false },
  { to: "/budgets", label: "Budgets", enabled: false },
  { to: "/categories", label: "Categories", enabled: false },
  { to: "/family", label: "Family Settings", enabled: true },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [scope, setScope] = useState<Scope>("family");
  const family = user!.families[0];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 px-2 text-lg font-semibold text-brand-700 dark:text-brand-400">Family Finance</div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                className="cursor-not-allowed rounded-lg px-3 py-2 text-sm font-medium text-slate-400 dark:text-slate-600"
                title="Coming soon"
              >
                {item.label}
              </span>
            )
          )}
        </nav>
        <button
          onClick={() => logout()}
          className="mt-4 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Sign out
        </button>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h1 className="text-base font-semibold">{family.name}</h1>
            <p className="text-xs text-slate-500">Signed in as {user!.name}</p>
          </div>
          <div
            role="tablist"
            aria-label="Dashboard scope"
            className="flex rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800"
          >
            {(["family", "personal"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={scope === s}
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1.5 font-medium capitalize transition-colors ${
                  scope === s
                    ? "bg-white text-brand-700 shadow-sm dark:bg-slate-950 dark:text-brand-300"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet context={{ family, scope } satisfies LayoutContext} />
        </main>
      </div>
    </div>
  );
}
