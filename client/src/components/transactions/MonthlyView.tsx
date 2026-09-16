import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Account, Transaction } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { cumulativeBalance } from "../../lib/carryOver";
import { weekBucketsForMonth } from "../../lib/weeks";
import type { WeekStart } from "../../lib/prefs";
import { MONTH_LABELS } from "../../lib/dateUtils";
import { EmptyState, Spinner } from "../ui";

interface Totals {
  income: number;
  expense: number;
}

function sumTotals(list: Transaction[]): Totals {
  return list.reduce<Totals>(
    (acc, t) => {
      if (t.type === "INCOME") acc.income += t.amount;
      else if (t.type === "EXPENSE") acc.expense += t.amount;
      return acc;
    },
    { income: 0, expense: 0 }
  );
}

export function MonthlyView({
  year,
  transactions,
  historyForCarryOver,
  accounts,
  accountIds,
  currency,
  carryOverEnabled,
  weekStart,
  isLoading,
}: {
  year: number;
  transactions: Transaction[];
  historyForCarryOver: Transaction[];
  accounts: Account[];
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

  if (isLoading) {
    return <Spinner label="Loading transactions..." />;
  }

  if (transactions.length === 0 && !carryOverEnabled) {
    return <EmptyState title="No transactions this year" description="Add a transaction to see monthly totals here." />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      {months.map((month) => {
        const isExpanded = expandedMonth === month.index;
        const hasActivity = month.transactions.length > 0;
        const carryOverAmount =
          !hasActivity && carryOverEnabled
            ? cumulativeBalance(accounts, historyForCarryOver, accountIds, month.monthStart)
            : 0;

        return (
          <div key={month.index} className="border-b border-slate-200 last:border-0 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setExpandedMonth(isExpanded ? null : month.index)}
              className="flex w-full items-center justify-between gap-3 bg-white px-4 py-3 text-left hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {month.label}
              </span>
              {hasActivity ? (
                <span className="flex gap-4 text-xs sm:text-sm">
                  <span className="text-income">+{formatCurrency(month.income, currency)}</span>
                  <span className="text-expense">-{formatCurrency(month.expense, currency)}</span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {formatCurrency(month.income - month.expense, currency)}
                  </span>
                </span>
              ) : carryOverEnabled ? (
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  Carry-over: {formatCurrency(carryOverAmount, currency)}
                </span>
              ) : (
                <span className="text-xs text-slate-400 dark:text-slate-500">No activity</span>
              )}
            </button>

            {isExpanded && (
              <div className="space-y-1.5 bg-slate-50 px-4 py-3 dark:bg-slate-950/40">
                {weekBucketsForMonth(month.monthStart, weekStart).map((week) => {
                  const weekTx = month.transactions.filter((t) => {
                    const d = new Date(t.date);
                    return d >= week.start && d <= week.end;
                  });
                  const weekTotals = sumTotals(weekTx);
                  const weekHasActivity = weekTx.length > 0;
                  const weekCarryOver =
                    !weekHasActivity && carryOverEnabled
                      ? cumulativeBalance(accounts, historyForCarryOver, accountIds, week.start)
                      : 0;

                  return (
                    <div
                      key={week.key}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs dark:bg-slate-900"
                    >
                      <span className="text-slate-500 dark:text-slate-400">
                        Week {week.weekNumber} · {format(week.start, "MMM d")}–{format(week.end, "MMM d")}
                      </span>
                      {weekHasActivity ? (
                        <span className="flex gap-3">
                          <span className="text-income">+{formatCurrency(weekTotals.income, currency)}</span>
                          <span className="text-expense">-{formatCurrency(weekTotals.expense, currency)}</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatCurrency(weekTotals.income - weekTotals.expense, currency)}
                          </span>
                        </span>
                      ) : carryOverEnabled ? (
                        <span className="text-slate-400 dark:text-slate-500">
                          Carry-over: {formatCurrency(weekCarryOver, currency)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">No activity</span>
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
