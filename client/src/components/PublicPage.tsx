import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LogoLockup } from "./Logo";
import { useAuth } from "../context/AuthContext";

/** Where people can reach whoever runs this deployment, if configured (VITE_SUPPORT_EMAIL at build time). */
export const SUPPORT_EMAIL = (import.meta.env.VITE_SUPPORT_EMAIL as string | undefined)?.trim() || null;

/** A plain reading page anyone can open without signing in: the privacy policy, account deletion. */
export function PublicPage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-6 sm:px-8">
        <Link to="/" aria-label="Family Finance home">
          <LogoLockup size={30} />
        </Link>
        <Link to={user ? "/dashboard" : "/login"} className="text-sm font-semibold text-brand-600 hover:underline">
          {user ? "Open the app" : "Sign in"}
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-16 sm:px-8">
        <div className="glass glass-solid rounded-3xl p-6 sm:p-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">{title}</h1>
          {updated && <p className="mt-2 text-sm text-ink-subtle">Last updated {updated}</p>}
          <div className="prose-ledger mt-6 space-y-4 text-sm leading-relaxed text-ink-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_strong]:text-ink">
            {children}
          </div>
        </div>
        <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-ink-subtle">
          <Link to="/privacy" className="hover:text-ink">
            Privacy policy
          </Link>
          <Link to="/delete-account" className="hover:text-ink">
            Delete your account
          </Link>
          <span>&copy; {new Date().getFullYear()} Family Finance</span>
        </footer>
      </main>
    </div>
  );
}
