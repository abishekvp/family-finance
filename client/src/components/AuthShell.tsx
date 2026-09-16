import type { ReactNode } from "react";
import { ArrowUpRight, PieChart, ShieldCheck, Users } from "lucide-react";
import { LogoLockup } from "./Logo";

const HIGHLIGHTS = [
  {
    icon: Users,
    title: "Shared and private, side by side",
    body: "Common household accounts sit next to accounts only you can see — one balance sheet, two levels of privacy.",
  },
  {
    icon: PieChart,
    title: "Every rupee accounted for",
    body: "Daily, calendar, monthly and total views over the same ledger, with budgets that track themselves.",
  },
  {
    icon: ShieldCheck,
    title: "Roles that actually mean something",
    body: "Admins, members and viewers get exactly the reach they should — enforced on the server, not just hidden in the UI.",
  },
];

/**
 * Two-column frame for the signed-out routes: the form on the left, a glass marketing panel
 * on the right that collapses away below `lg` so phones get a focused single column.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[26rem] animate-rise-in">
          <LogoLockup className="mb-9" />

          <h1 className="text-2xl font-extrabold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{subtitle}</p>

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-7 text-center text-sm text-ink-muted">{footer}</div>}
        </div>
      </div>

      <aside className="hidden w-[46%] max-w-2xl shrink-0 items-center p-6 lg:flex xl:p-10">
        <div className="glass ring-gradient relative h-full w-full overflow-hidden rounded-4xl p-10 xl:p-12">
          <div className="flex h-full flex-col justify-between">
            <div>
              <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-brand-600">
                Family Finance
              </p>
              <h2 className="mt-4 max-w-md text-[2.125rem] font-extrabold leading-[1.1] tracking-tight text-ink">
                One ledger for the whole household.{" "}
                <span className="brand-text-gradient">Privacy where it matters.</span>
              </h2>
            </div>

            <ul className="my-10 space-y-6">
              {HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="flex gap-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-600">
                      <Icon size={18} />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-ink">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.body}</p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center gap-2 text-xs font-medium text-ink-subtle">
              <ArrowUpRight size={14} className="text-brand-500" />
              Also available as an installable web app and an Android build.
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
