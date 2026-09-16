import { useMemo, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import type { Account, Transaction } from "../../api/types";
import { TransactionRow } from "./TransactionRow";
import { EmptyOrCarryOver } from "./EmptyOrCarryOver";
import { formatCurrency } from "../../lib/format";
import { cumulativeBalance } from "../../lib/carryOver";
import { weekStartsOn, type WeekStart } from "../../lib/prefs";
import { Spinner } from "../ui";

const WEEKDAY_LABELS_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MONDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView({
  monthDate,
  transactions,
  historyForCarryOver,
  accounts,
  accountIds,
  periodStart,
  currency,
  carryOverEnabled,
  weekStart,
  isLoading,
  onRowClick,
}: {
  monthDate: Date;
  transactions: Transaction[];
  historyForCarryOver: Transaction[];
  accounts: Account[];
  accountIds: Set<string>;
  periodStart: Date;
  currency: string;
  carryOverEnabled: boolean;
  weekStart: WeekStart;
  isLoading: boolean;
  onRowClick: (transaction: Transaction) => void;
}) {
  const wsOn = weekStartsOn(weekStart);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: wsOn });
    const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: wsOn });
    const result: Date[] = [];
    let cursor = start;
    while (cursor <= end) {
      result.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return result;
  }, [monthDate, wsOn]);

  const totalsByDay = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const t of transactions) {
      const key = format(new Date(t.date), "yyyy-MM-dd");
      const entry = map.get(key) ?? { income: 0, expense: 0 };
      if (t.type === "INCOME") entry.income += t.amount;
      else if (t.type === "EXPENSE") entry.expense += t.amount;
      map.set(key, entry);
    }
    return map;
  }, [transactions]);

  if (isLoading) {
    return <Spinner label="Loading transactions..." />;
  }

  const weekdayLabels = wsOn === 1 ? WEEKDAY_LABELS_MONDAY : WEEKDAY_LABELS_SUNDAY;
  const selectedDayTransactions = selectedDay
    ? transactions.filter((t) => isSameDay(new Date(t.date), selectedDay))
    : [];

  return (
    <div className="space-y-4">
      {transactions.length === 0 && (
        <EmptyOrCarryOver
          carryOverEnabled={carryOverEnabled}
          amount={carryOverEnabled ? cumulativeBalance(accounts, historyForCarryOver, accountIds, periodStart) : 0}
          currency={currency}
          emptyTitle="No transactions in this period"
          emptyDescription="Add a transaction to see it plotted on the calendar."
        />
      )}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 text-[11px] dark:border-slate-800 dark:bg-slate-800">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="bg-slate-100 px-2 py-1.5 text-center font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400"
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const totals = totalsByDay.get(key);
          const inMonth = isSameMonth(day, monthDate);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          return (
            <button
              type="button"
              key={key}
              onClick={() => setSelectedDay(day)}
              className={`flex min-h-[64px] flex-col items-start gap-0.5 bg-white px-1.5 py-1.5 text-left transition-colors dark:bg-slate-900 ${
                inMonth ? "" : "opacity-40"
              } ${
                isSelected
                  ? "ring-2 ring-inset ring-brand-500"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
              }`}
            >
              <span
                className={`text-[11px] font-medium ${inMonth ? "text-slate-700 dark:text-slate-200" : "text-slate-400 dark:text-slate-600"}`}
              >
                {format(day, "d")}
              </span>
              {totals?.income ? <span className="text-income">+{formatCurrency(totals.income, currency)}</span> : null}
              {totals?.expense ? <span className="text-expense">-{formatCurrency(totals.expense, currency)}</span> : null}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
            {format(selectedDay, "EEEE, MMM d")}
          </p>
          {selectedDayTransactions.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No transactions on this day.</p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {selectedDayTransactions.map((t) => (
                <TransactionRow key={t.id} transaction={t} onClick={() => onRowClick(t)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
