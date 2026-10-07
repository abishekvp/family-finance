import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";
import { cn, EmptyState, SkeletonRows } from "../ui";
import { cumulativeBalance } from "../../lib/carryOver";
import { weekBucketsForMonth } from "../../lib/weeks";
import type { WeekStart } from "../../lib/prefs";
import { MONTH_LABELS } from "../../lib/dateUtils";
import { safePercent } from "../../lib/format";
import { countedAmount, countsTowardTotals } from "../../lib/transactionTotals";

interface Totals {
  income: number;
  expense: number;
}

function sumTotals(list: Transaction[]): Totals {
  return list.reduce<Totals>(
    (acc, t) => {
      if (!countsTowardTotals(t)) return acc;
      if (t.type === "INCOME") acc.income += countedAmount(t);
      else if (t.type === "EXPENSE") acc.expense += countedAmount(t);
      return acc;
    },
    { income: 0, expense: 0 }
  );
}

export function MonthlyView({
  year,
  transactions,
  historyForCarryOver,
  startBalances,
  accountIds,
  currency,
  carryOverEnabled,
  weekStart,
  isLoading,
}: {
  year: number;
  transactions: Transaction[];
  /** This year's transactions, for the carry-over. */
  historyForCarryOver: Transaction[];
  /** Each account's balance when the year began, for the carry-over. */
  startBalances: Record<string, number> | undefined;
  /** Whose balances the carry-over adds up. */
  accountIds: Set<string>;
  currency: string;
  carryOverEnabled: boolean;
  weekStart: WeekStart;
  isLoading: boolean;
}) {
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  const months = useMemo(() => {
    return MONTH_LABELS.map((label, index) => {
      const monthStart = new Date(year, index, 1);
      const monthEnd = new Date(year, index + 1, 1);
      const monthTx = transactions.filter((t) => {
        const d = new Date(t.date);
        return d >= monthStart && d < monthEnd;
      });
      return { index, label, monthStart, monthEnd, transactions: monthTx, ...sumTotals(monthTx) };
    });
  }, [transactions, year]);

  const yearPeak = useMemo(
    () => Math.max(1, ...months.map((m) => Math.max(m.income, m.expense))),
    [months]
  );

  if (isLoading) {
    return <SkeletonRows rows={6} />;
  }

  if (transactions.length === 0 && !carryOverEnabled) {
    return <EmptyState title="No transactions this year" description="Add a transaction to see monthly totals here." />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      {months.map((month) => {
        const isExpanded = expandedMonth === month.index;
        const hasActivity = month.transactions.length > 0;
        const carryOverAmount =
          !hasActivity && carryOverEnabled
            ? cumulativeBalance(startBalances, historyForCarryOver, accountIds, month.monthStart)
            : 0;

        return (
          <div key={month.index} className="border-b border-line last:border-0">
            <button
              type="button"
              onClick={() => setExpandedMonth(isExpanded ? null : month.index)}
              className="flex w-full items-center justify-between gap-3 bg-surface/40 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {month.label}
              </span>

              {hasActivity ? (
                <span className="flex items-center gap-3">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken sm:block">
                    <span
                      className="block h-full rounded-full bg-expense"
                      style={{ width: `${safePercent(month.expense, yearPeak)}%` }}
                    />
                  </span>
                  <span className="flex gap-3 text-xs sm:text-sm">
                    <span className="tnum text-income">
                      +<Money amount={month.income} currency={currency} compact />
                    </span>
                    <span className="tnum text-expense">
                      −<Money amount={month.expense} currency={currency} compact />
                    </span>
                    <span className="tnum font-bold text-ink">
                      <Money amount={month.income - month.expense} currency={currency} compact />
                    </span>
                  </span>
                </span>
              ) : carryOverEnabled ? (
                <span className="text-xs text-ink-subtle">
                  Carried over: <Money amount={carryOverAmount} currency={currency} compact />
                </span>
              ) : (
                <span className="text-xs text-ink-subtle">No activity</span>
              )}
            </button>

            {isExpanded && (
              <div className="space-y-1.5 bg-surface-sunken/50 px-4 py-3">
                {weekBucketsForMonth(month.monthStart, weekStart).map((week) => {
                  const weekTx = month.transactions.filter((t) => {
                    const d = new Date(t.date);
                    return d >= week.start && d <= week.end;
                  });
                  const weekTotals = sumTotals(weekTx);
                  const weekHasActivity = weekTx.length > 0;
                  const weekCarryOver =
                    !weekHasActivity && carryOverEnabled
                      ? cumulativeBalance(startBalances, historyForCarryOver, accountIds, week.start)
                      : 0;

                  return (
                    <div
                      key={week.key}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-xs"
                      )}
                    >
                      <span className="text-ink-subtle">
                        Week {week.weekNumber} · {format(week.start, "MMM d")}–{format(week.end, "MMM d")}
                      </span>
                      {weekHasActivity ? (
                        <span className="flex gap-3 tnum">
                          <span className="text-income">
                            +<Money amount={weekTotals.income} currency={currency} compact />
                          </span>
                          <span className="text-expense">
                            −<Money amount={weekTotals.expense} currency={currency} compact />
                          </span>
                          <span className="font-semibold text-ink">
                            <Money amount={weekTotals.income - weekTotals.expense} currency={currency} compact />
                          </span>
                        </span>
                      ) : carryOverEnabled ? (
                        <span className="tnum text-ink-subtle">
                          Carried over: <Money amount={weekCarryOver} currency={currency} compact />
                        </span>
                      ) : (
                        <span className="text-ink-subtle">No activity</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
