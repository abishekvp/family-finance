import { useMemo, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import type { Account, Transaction } from "../../api/types";
import { TransactionRow } from "./TransactionRow";
import { EmptyOrCarryOver } from "./EmptyOrCarryOver";
import { Money } from "../figures";
import { cn, SkeletonRows } from "../ui";
import { cumulativeBalance } from "../../lib/carryOver";
import { weekStartsOn, type WeekStart } from "../../lib/prefs";
import { countedAmount } from "../../lib/transactionTotals";
import { isPerson } from "../../lib/lending";

const WEEKDAY_LABELS_SUNDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_MONDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarView({
  monthDate,
  transactions,
  historyForCarryOver,
  startBalances,
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
  /** This year's transactions, for the carry-over. */
  historyForCarryOver: Transaction[];
  /** Each account's balance when the year began, for the carry-over. */
  startBalances: Record<string, number> | undefined;
  accounts: Account[];
  /** Whose balances the carry-over adds up. */
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
  const people = useMemo(() => new Set(accounts.filter(isPerson).map((a) => a.id)), [accounts]);

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
      if (t.type === "INCOME") entry.income += countedAmount(t);
      else if (t.type === "EXPENSE") entry.expense += countedAmount(t);
      map.set(key, entry);
    }
    return map;
  }, [transactions]);

  if (isLoading) {
    return <SkeletonRows rows={5} />;
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
          amount={carryOverEnabled ? cumulativeBalance(startBalances, historyForCarryOver, accountIds, periodStart) : 0}
          currency={currency}
          emptyTitle="No transactions in this period"
          emptyDescription="Add a transaction to see it plotted on the calendar."
        />
      )}

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line text-2xs">
        {weekdayLabels.map((label) => (
          <div key={label} className="bg-surface-sunken px-1 py-1.5 text-center font-semibold text-ink-subtle">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const totals = totalsByDay.get(key);
          const inMonth = isSameMonth(day, monthDate);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const today = isToday(day);
          return (
            <button
              type="button"
              key={key}
              onClick={() => setSelectedDay(day)}
              className={cn(
                "flex min-h-[58px] flex-col items-start gap-0.5 bg-surface px-1.5 py-1.5 text-left transition-colors duration-150 sm:min-h-[72px]",
                !inMonth && "opacity-35",
                isSelected ? "brand-gradient" : "hover:bg-surface-sunken"
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-2xs font-bold",
                  isSelected
                    ? "bg-white/25 text-white"
                    : today
                      ? "bg-brand-soft text-brand-600"
                      : "text-ink-muted"
                )}
              >
                {format(day, "d")}
              </span>
              <span className="flex flex-col gap-0.5 leading-tight">
                {totals?.income ? (
                  <span className={cn("tnum text-2xs font-semibold", isSelected ? "text-white" : "text-income")}>
                    +<Money amount={totals.income} currency={currency} compact />
                  </span>
                ) : null}
                {totals?.expense ? (
                  <span className={cn("tnum text-2xs font-semibold", isSelected ? "text-white/90" : "text-expense")}>
                    −<Money amount={totals.expense} currency={currency} compact />
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="rounded-2xl border border-line bg-surface/40 p-4">
          <p className="mb-2 text-sm font-semibold text-ink-muted">{format(selectedDay, "EEEE, MMM d")}</p>
          {selectedDayTransactions.length === 0 ? (
            <p className="text-sm text-ink-subtle">No transactions on this day.</p>
          ) : (
            <div className="divide-y divide-line">
              {selectedDayTransactions.map((t) => (
                <TransactionRow key={t.id} transaction={t} people={people} onClick={() => onRowClick(t)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
