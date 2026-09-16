import { useMemo } from "react";
import { format } from "date-fns";
import type { Account, Transaction } from "../../api/types";
import { TransactionRow } from "./TransactionRow";
import { EmptyOrCarryOver } from "./EmptyOrCarryOver";
import { formatCurrency } from "../../lib/format";
import { cumulativeBalance } from "../../lib/carryOver";
import { Spinner } from "../ui";

interface DailyGroup {
  key: string;
  date: Date;
  income: number;
  expense: number;
  transactions: Transaction[];
}

export function DailyView({
  transactions,
  historyForCarryOver,
  accounts,
  accountIds,
  periodStart,
  currency,
  carryOverEnabled,
  isLoading,
  onRowClick,
}: {
  transactions: Transaction[];
  historyForCarryOver: Transaction[];
  accounts: Account[];
  accountIds: Set<string>;
  periodStart: Date;
  currency: string;
  carryOverEnabled: boolean;
  isLoading: boolean;
  onRowClick: (transaction: Transaction) => void;
}) {
  const groups = useMemo<DailyGroup[]>(() => {
    const map = new Map<string, DailyGroup>();
    for (const t of transactions) {
      const date = new Date(t.date);
      const key = format(date, "yyyy-MM-dd");
      let group = map.get(key);
      if (!group) {
        group = { key, date, income: 0, expense: 0, transactions: [] };
        map.set(key, group);
      }
      group.transactions.push(t);
      if (t.type === "INCOME") group.income += t.amount;
      else if (t.type === "EXPENSE") group.expense += t.amount;
    }
    return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [transactions]);

  if (isLoading) {
    return <Spinner label="Loading transactions..." />;
  }

  if (groups.length === 0) {
    const amount = carryOverEnabled
      ? cumulativeBalance(accounts, historyForCarryOver, accountIds, periodStart)
      : 0;
    return (
      <EmptyOrCarryOver
        carryOverEnabled={carryOverEnabled}
        amount={amount}
        currency={currency}
        emptyTitle="No transactions in this period"
        emptyDescription="Add a transaction or pick a different month to see activity here."
      />
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {format(group.date, "EEEE, MMM d")}
            </p>
            <div className="flex gap-3 text-xs">
              {group.income > 0 && <span className="text-income">+{formatCurrency(group.income, currency)}</span>}
              {group.expense > 0 && <span className="text-expense">-{formatCurrency(group.expense, currency)}</span>}
            </div>
          </div>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-3 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {group.transactions.map((t) => (
              <TransactionRow key={t.id} transaction={t} onClick={() => onRowClick(t)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
