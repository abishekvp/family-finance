import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ArrowLeftRight,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  PieChart,
  Settings as SettingsIcon,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import type { FamilySummary } from "../context/AuthContext";
import { useTheme, type ThemeChoice } from "../lib/theme";
import { Avatar, Badge, cn, Popover, Segmented } from "./ui";
import { Logo } from "./Logo";

export type Scope = "family" | "personal";

export interface LayoutContext {
  family: FamilySummary;
  scope: Scope;
}

const SCOPE_KEY = "scope:v1";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Shown in the phone tab bar; the rest stay in the sidebar and the "More" sheet. */
  primary?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, primary: true },
  { to: "/transactions", label: "Transactions", icon: ArrowLeftRight, primary: true },
  { to: "/stats", label: "Insights", icon: PieChart, primary: true },
  { to: "/accounts", label: "Accounts", icon: Wallet, primary: true },
  { to: "/account", label: "Account & security", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
  { to: "/family", label: "Family", icon: Users },
  { to: "/get-the-app", label: "Get the app", icon: Smartphone },
];

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Overview",
  "/transactions": "Transactions",
  "/stats": "Insights",
  "/accounts": "Accounts",
  "/settings": "Settings",
  "/family": "Family",
  "/get-the-app": "Get the app",
};

function readScope(): Scope {
  try {
    return localStorage.getItem(SCOPE_KEY) === "personal" ? "personal" : "family";
  } catch {
    return "family";
  }
}

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [scope, setScope] = useState<Scope>(readScope);
  const family = user!.families[0];

  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_KEY, scope);
    } catch {
      // Best-effort: the toggle still works for this session.
    }
  }, [scope]);

  const title = PAGE_TITLES[location.pathname] ?? family.name;

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar family={family} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} family={family} scope={scope} onScopeChange={setScope} onLogout={logout} />

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 sm:pb-10 lg:px-8">
          <div key={location.pathname} className="animate-rise-in">
            <Outlet context={{ family, scope } satisfies LayoutContext} />
          </div>
        </main>
      </div>

      <MobileTabBar />
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

function DesktopSidebar({ family }: { family: FamilySummary }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-line bg-surface/80 px-3 py-5 backdrop-blur-glass transform-gpu lg:flex">
      <div className="mb-7 flex items-center gap-2.5 px-2">
        <Logo size={32} />
        <div className="min-w-0">
          <p className="truncate text-sm font-bold leading-tight text-ink">Family Finance</p>
          <p className="truncate text-2xs text-ink-subtle">{family.name}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>

      <div className="mt-4 px-2">
        <ThemeSwitcher />
      </div>
    </aside>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-200 ease-swift",
          isActive
            ? "bg-brand-soft text-brand-600"
            : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full brand-gradient transition-opacity duration-200",
              isActive ? "opacity-100" : "opacity-0"
            )}
          />
          <Icon size={18} strokeWidth={isActive ? 2.4 : 1.9} className="shrink-0" />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/* ------------------------------------------------------------------- top bar */

function TopBar({
  title,
  family,
  scope,
  onScopeChange,
  onLogout,
}: {
  title: string;
  family: FamilySummary;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-glass transform-gpu">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="lg:hidden">
            <Logo size={30} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight text-ink sm:text-lg">{title}</h1>
            <p className="hidden truncate text-xs text-ink-subtle sm:block">{family.name}</p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Segmented
            size="sm"
            value={scope}
            onChange={onScopeChange}
            options={[
              { value: "family", label: "Family" },
              { value: "personal", label: "Personal" },
            ]}
            className="hidden sm:inline-flex"
          />
          <AccountMenu scope={scope} onScopeChange={onScopeChange} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}

function AccountMenu({
  scope,
  onScopeChange,
  onLogout,
}: {
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 transition hover:bg-surface-sunken"
      >
        <Avatar name={user!.name} size={32} />
        <ChevronDown size={14} className="text-ink-subtle" />
      </button>

      {open && (
        <Popover onClose={() => setOpen(false)} className="w-64">
          <div className="flex items-center gap-3 pb-3">
            <Avatar name={user!.name} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{user!.name}</p>
              <p className="truncate text-xs text-ink-subtle">{user!.email}</p>
            </div>
          </div>

          <div className="border-t border-line pt-3 sm:hidden">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Scope</p>
            <Segmented
              size="sm"
              value={scope}
              onChange={onScopeChange}
              className="w-full"
              options={[
                { value: "family", label: "Family" },
                { value: "personal", label: "Personal" },
              ]}
            />
          </div>

          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Appearance</p>
            <ThemeSwitcher />
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="mt-3 flex w-full items-center gap-2.5 rounded-xl border-t border-line px-1 pt-3 text-sm font-medium text-ink-muted transition hover:text-expense"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </Popover>
      )}
    </div>
  );
}

function ThemeSwitcher() {
  const { choice, setChoice } = useTheme();
  const options: { value: ThemeChoice; label: ReactNode }[] = [
    { value: "light", label: <Sun size={14} aria-label="Light" /> },
    { value: "dark", label: <Moon size={14} aria-label="Dark" /> },
    { value: "system", label: <Monitor size={14} aria-label="System" /> },
  ];
  return <Segmented size="sm" value={choice} onChange={setChoice} options={options} className="w-full" />;
}

/* -------------------------------------------------------------- mobile tabs */

function MobileTabBar() {
  const primary = NAV_ITEMS.filter((i) => i.primary);
  const [moreOpen, setMoreOpen] = useState(false);
  const secondary = NAV_ITEMS.filter((i) => !i.primary);

  return (
    <>
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 backdrop-blur-glass transform-gpu lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {primary.map((item) => (
            <TabLink key={item.to} item={item} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-2xs font-semibold text-ink-subtle"
          >
            <span className="grid h-6 w-6 place-items-center">
              <MoreGlyph />
            </span>
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden">
          <div
            className="absolute inset-0 animate-fade-in bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
            aria-hidden
          />
          <div className="glass glass-solid safe-bottom relative z-10 w-full animate-sheet-up rounded-t-3xl p-4 shadow-float">
            <div aria-hidden className="mx-auto mb-4 h-1 w-9 rounded-full bg-line-strong" />
            <div className="grid gap-1">
              {secondary.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition",
                        isActive ? "bg-brand-soft text-brand-600" : "text-ink hover:bg-surface-sunken"
                      )
                    }
                  >
                    <Icon size={18} />
                    {item.label}
                    {item.to === "/get-the-app" && (
                      <Badge tone="brand" className="ml-auto">
                        Android
                      </Badge>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TabLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "relative flex flex-1 flex-col items-center gap-1 py-2.5 text-2xs font-semibold transition-colors",
          isActive ? "text-brand-600" : "text-ink-subtle"
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            aria-hidden
            className={cn(
              "absolute inset-x-5 top-0 h-0.5 rounded-b-full brand-gradient transition-opacity",
              isActive ? "opacity-100" : "opacity-0"
            )}
          />
          <span
            className={cn(
              "grid h-6 w-6 place-items-center transition-transform duration-200 ease-snap",
              isActive && "-translate-y-0.5 scale-110"
            )}
          >
            <Icon size={19} strokeWidth={isActive ? 2.4 : 1.9} />
          </span>
          {item.label}
        </>
      )}
    </NavLink>
  );
}

function MoreGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
