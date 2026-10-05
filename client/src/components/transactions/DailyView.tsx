import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import type { Account, Transaction } from "../../api/types";
import { TransactionRow } from "./TransactionRow";
import { EmptyOrCarryOver } from "./EmptyOrCarryOver";
import { Money } from "../figures";
import { cumulativeBalance } from "../../lib/carryOver";
import { SkeletonRows } from "../ui";
import { countedAmount } from "../../lib/transactionTotals";

// The list draws this many rows at first and this many more each time its end scrolls near the screen.
const PAGE_ROWS = 60;

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
      if (t.type === "INCOME") group.income += countedAmount(t);
      else if (t.type === "EXPENSE") group.expense += countedAmount(t);
    }
    return Array.from(map.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [transactions]);

  // Load on scroll: a busy month paints its first rows at once and the rest as they come into view.
  const [limit, setLimit] = useState(PAGE_ROWS);
  useEffect(() => setLimit(PAGE_ROWS), [transactions]);
  const visible = useMemo(() => {
    const out: DailyGroup[] = [];
    let rows = 0;
    for (const g of groups) {
      if (rows >= limit) break;
      const take = g.transactions.slice(0, limit - rows);
      rows += take.length;
      out.push({ ...g, transactions: take });
    }
    return out;
  }, [groups, limit]);
  const hasMore = transactions.length > limit;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((n) => n + PAGE_ROWS);
    }, { rootMargin: "600px 0px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visible.length]);

  if (isLoading) {
    return <SkeletonRows rows={5} />;
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
    <div className="space-y-5">
      <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_4.5rem_8.5rem] gap-4 border-b border-line px-4 pb-2 text-2xs font-semibold uppercase tracking-wide text-ink-subtle lg:grid">
        <span>Description</span>
        <span>Category</span>
        <span>Account</span>
        <span>Time</span>
        <span className="text-right">Amount</span>
      </div>
      {visible.map((group) => (
        <div key={group.key}>
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-semibold text-ink-muted">{format(group.date, "EEEE, MMM d")}</p>
            <div className="flex gap-3 text-xs font-semibold tnum">
              {group.income > 0 && <Money amount={group.income} currency={currency} tone="income" signed />}
              {group.expense > 0 && <Money amount={-group.expense} currency={currency} tone="expense" signed />}
            </div>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line bg-surface/40 px-3">
            {group.transactions.map((t) => (
              <TransactionRow key={t.id} transaction={t} onClick={() => onRowClick(t)} detailed />
            ))}
          </div>
        </div>
      ))}
      {hasMore && (
        <div ref={sentinel} className="py-4 text-center text-xs text-ink-subtle">
          Loading more… ({transactions.length - limit} to go)
        </div>
      )}
    </div>
  );
}
