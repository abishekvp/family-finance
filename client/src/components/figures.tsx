import type { ReactNode } from "react";
import { formatCompactCurrency, formatCurrency, formatSignedCurrency } from "../lib/format";
import { cn, Skeleton } from "./ui";

/**
 * A money figure. Always tabular so amounts line up in a column, and tinted by sign only
 * when `signed` or an explicit `tone` asks for it — a plain balance stays ink-coloured.
 */
export function Money({
  amount,
  currency,
  signed = false,
  compact = false,
  tone,
  className = "",
}: {
  amount: number;
  currency: string;
  signed?: boolean;
  compact?: boolean;
  tone?: "income" | "expense" | "auto" | "muted";
  className?: string;
}) {
  const resolvedTone =
    tone === "auto" ? (amount < 0 ? "expense" : amount > 0 ? "income" : "muted") : tone;

  const text = signed
    ? formatSignedCurrency(amount, currency)
    : compact
      ? formatCompactCurrency(amount, currency)
      : formatCurrency(amount, currency);

  return (
    <span
      className={cn(
        "tnum tracking-tight",
        resolvedTone === "income" && "text-income",
        resolvedTone === "expense" && "text-expense",
        resolvedTone === "muted" && "text-ink-muted",
        className
      )}
    >
      {text}
    </span>
  );
}

/**
 * The hero metric tile. `accent` paints the icon chip and the soft wash behind the figure —
 * used to distinguish net worth / income / expense at a glance without recolouring the number.
 */
export function StatTile({
  label,
  value,
  currency,
  hint,
  icon,
  accent = "brand",
  loading = false,
  compact = false,
  tone,
  className = "",
  children,
}: {
  label: string;
  value: number;
  currency: string;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: "brand" | "income" | "expense" | "info";
  loading?: boolean;
  compact?: boolean;
  tone?: "income" | "expense" | "auto";
  className?: string;
  children?: ReactNode;
}) {
  const accents = {
    brand: { chip: "bg-brand-soft text-brand-600", wash: "from-brand-500/12" },
    income: { chip: "bg-income-soft text-income", wash: "from-income/12" },
    expense: { chip: "bg-expense-soft text-expense", wash: "from-expense/12" },
    info: { chip: "bg-info-soft text-info", wash: "from-info/12" },
  }[accent];

  return (
    <div className={cn("glass relative overflow-hidden rounded-2xl p-5", className)}>
      <div
        aria-hidden
        className={cn("pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-gradient-to-br to-transparent blur-2xl", accents.wash)}
      />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-ink-muted">{label}</p>
        {icon && (
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", accents.chip)}>{icon}</span>
        )}
      </div>

      {loading ? (
        <Skeleton className="relative mt-3 h-8 w-32" />
      ) : (
        <p className="relative mt-2.5 text-[1.75rem] font-bold leading-none">
          <Money amount={value} currency={currency} compact={compact} tone={tone} />
        </p>
      )}

      {hint && <div className="relative mt-2 text-xs text-ink-subtle">{hint}</div>}
      {children && <div className="relative mt-3">{children}</div>}
    </div>
  );
}
