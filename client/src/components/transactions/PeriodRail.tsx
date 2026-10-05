import { useMemo } from "react";
import type { Account, Transaction } from "../../api/types";
import { categoryTotals } from "../../lib/analytics";
import { formatCurrency, formatPercent } from "../../lib/format";
import { countedAmount } from "../../lib/transactionTotals";
import { Card, Dot, SkeletonRows } from "../ui";

/**
 * The side panel beside the transaction list on a wide screen: the viewed period classified — spending
 * and income by category, and what moved through each account.
 */
export function PeriodRail({
  transactions,
  accounts,
  accountIds,
  currency,
  periodLabel,
  isLoading,
}: {
  transactions: Transaction[];
  accounts: Account[];
  accountIds: Set<string>;
  currency: string;
  periodLabel: string;
  isLoading: boolean;
}) {
  const spending = useMemo(() => categoryTotals(transactions, accountIds, "EXPENSE"), [transactions, accountIds]);
  const income = useMemo(() => categoryTotals(transactions, accountIds, "INCOME"), [transactions, accountIds]);
  const byAccount = useMemo(() => {
    const map = new Map<string, { inflow: number; outflow: number }>();
    for (const t of transactions) {
      if (!accountIds.has(t.accountId) || (t.type !== "INCOME" && t.type !== "EXPENSE")) continue;
      const entry = map.get(t.accountId) ?? { inflow: 0, outflow: 0 };
      if (t.type === "INCOME") entry.inflow += countedAmount(t);
      else entry.outflow += countedAmount(t);
      map.set(t.accountId, entry);
    }
    return Array.from(map.entries())
      .map(([id, v]) => ({ id, name: accounts.find((a) => a.id === id)?.name ?? "Account", ...v }))
      .sort((a, b) => b.outflow + b.inflow - (a.outflow + a.inflow));
  }, [transactions, accountIds, accounts]);

  return (
    <aside className="space-y-5">
      <Breakdown title="Spending by category" subtitle={periodLabel} rows={spending} currency={currency} isLoading={isLoading} />
      <Breakdown title="Income by category" subtitle={periodLabel} rows={income} currency={currency} isLoading={isLoading} />
      <Card>
        <h3 className="text-sm font-semibold text-ink">By account</h3>
        <p className="mb-3 text-xs text-ink-subtle">Money in and out in {periodLabel}</p>
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : byAccount.length === 0 ? (
          <p className="text-sm text-ink-subtle">Nothing in this period.</p>
        ) : (
          <ul className="divide-y divide-line">
            {byAccount.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">{a.name}</span>
                <span className="tnum shrink-0 text-right text-xs">
                  {a.inflow > 0 && <span className="block text-income">+{formatCurrency(a.inflow, currency)}</span>}
                  {a.outflow > 0 && <span className="block text-expense">−{formatCurrency(a.outflow, currency)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </aside>
  );
}

function Breakdown({
  title,
  subtitle,
  rows,
  currency,
  isLoading,
}: {
  title: string;
  subtitle: string;
  rows: { key: string; name: string; color: string; amount: number }[];
  currency: string;
  isLoading: boolean;
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const shown = rows.slice(0, 8);
  const rest = rows.slice(8).reduce((s, r) => s + r.amount, 0);
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-xs text-ink-subtle">{subtitle}</p>
        </div>
        {total > 0 && <span className="tnum text-sm font-bold text-ink">{formatCurrency(total, currency)}</span>}
      </div>
      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">Nothing in this period.</p>
      ) : (
        <ul className="space-y-2.5">
          {shown.map((r) => (
            <li key={r.key}>
              <div className="mb-1 flex items-center gap-2 text-sm">
                <Dot color={r.color} size={8} />
                <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
                <span className="tnum text-2xs text-ink-subtle">{formatPercent(r.amount / total)}</span>
                <span className="tnum w-24 text-right font-semibold text-ink">{formatCurrency(r.amount, currency)}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div className="h-full rounded-full" style={{ width: `${(r.amount / total) * 100}%`, backgroundColor: r.color }} />
              </div>
            </li>
          ))}
          {rest > 0 && (
            <li className="flex justify-between text-xs text-ink-subtle">
              <span>{rows.length - shown.length} more</span>
              <span className="tnum">{formatCurrency(rest, currency)}</span>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
