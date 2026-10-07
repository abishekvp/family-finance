import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addMonths, addYears, format, subMonths, subYears } from "date-fns";
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, PieChart as PieChartIcon, Receipt, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button, Card, Dot, EmptyState, ErrorText, Segmented, SkeletonRows, cn } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Budget, Transaction } from "../api/types";
import { monthRange, yearRange } from "../lib/dateUtils";
import { formatCurrency, formatPercent } from "../lib/format";
import { CategoryPie } from "../components/stats/CategoryPie";
import { countedAmount } from "../lib/transactionTotals";
import { useFamilyData, useYearTransactions } from "../context/FamilyDataContext";
import { useCachedGet } from "../lib/sessionCache";
import { cashflow, categoryTotals, categoryTrend, monthBuckets, type CategoryTotal } from "../lib/analytics";
import { CashflowChart, ChartCard, Legend, PaceChart, SimpleBars, StackedBars, useChartPalette } from "../components/charts";

type Metric = "Income" | "Expenses";
type Period = "Monthly" | "Yearly";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function inRange(transactions: Transaction[], from: Date, to: Date) {
  return transactions.filter((t) => {
    const d = new Date(t.date);
    return d >= from && d < to;
  });
}

function totals(transactions: Transaction[], accountIds: Set<string>) {
  let income = 0;
  let expense = 0;
  let count = 0;
  for (const t of transactions) {
    if (!accountIds.has(t.accountId) || (t.type !== "INCOME" && t.type !== "EXPENSE")) continue;
    const amount = countedAmount(t);
    if (amount <= 0) continue;
    count++;
    if (t.type === "INCOME") income += amount;
    else expense += amount;
  }
  return { income, expense, net: income - expense, count };
}

export function Stats() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const palette = useChartPalette();
  const [metric, setMetric] = useState<Metric>("Expenses");
  const [period, setPeriod] = useState<Period>("Monthly");
  const [anchor, setAnchor] = useState(() => new Date());

  const { accounts, sharedAccounts, isLoadingStatic, staticError } = useFamilyData();
  const type = metric === "Income" ? "INCOME" : "EXPENSE";
  const metricColor = metric === "Income" ? palette.income : palette.expense;

  const year = anchor.getFullYear();
  const range = period === "Yearly" ? yearRange(year) : monthRange(anchor);
  const previousAnchor = period === "Yearly" ? subYears(anchor, 1) : subMonths(anchor, 1);
  const previousRange = period === "Yearly" ? yearRange(previousAnchor.getFullYear()) : monthRange(previousAnchor);
  const periodLabel = period === "Yearly" ? String(year) : format(anchor, "MMMM yyyy");
  const previousLabel = period === "Yearly" ? String(year - 1) : format(previousAnchor, "MMMM");

  // This year and last: enough for the period, the one before it, and twelve trailing months.
  const thisYear = useYearTransactions(year);
  const lastYear = useYearTransactions(year - 1);
  const isLoading = isLoadingStatic || thisYear.isLoading || lastYear.isLoading;
  const all = useMemo(() => [...lastYear.data, ...thisYear.data], [thisYear.data, lastYear.data]);

  const accountIds = useMemo(() => {
    // The family's view takes in the accounts members share with the family too.
    const scoped = scope === "family" ? [...accounts, ...sharedAccounts] : accounts.filter((a) => a.owner?.id === user!.id);
    return new Set(scoped.map((a) => a.id));
  }, [accounts, sharedAccounts, scope, user]);

  const current = useMemo(() => inRange(all, range.from, range.to), [all, range.from, range.to]);
  const previous = useMemo(() => inRange(all, previousRange.from, previousRange.to), [all, previousRange.from, previousRange.to]);
  const now = totals(current, accountIds);
  const before = totals(previous, accountIds);

  // The period's budgets, for "money used" against what was planned.
  const budgetParams = period === "Monthly" ? { year, month: anchor.getMonth() + 1 } : { year, period: "ANNUAL" };
  const { data: budgets = [] } = useCachedGet<Budget[]>(`/families/${family.id}/budgets`, budgetParams, { fallback: [] });
  const budgetTotal = budgets.reduce((sum, b) => sum + b.amount, 0);

  // Twelve months of cash flow: the year's months, or the twelve ending with the viewed month.
  const flowBuckets = useMemo(() => monthBuckets(period === "Yearly" ? new Date(year, 11, 1) : anchor, 12), [period, year, anchor]);
  const flow = useMemo(() => cashflow(all, accountIds, flowBuckets), [all, accountIds, flowBuckets]);

  const slices = useMemo(() => categoryTotals(current, accountIds, type), [current, accountIds, type]);
  const previousSlices = useMemo(() => new Map(categoryTotals(previous, accountIds, type).map((s) => [s.key, s.amount])), [previous, accountIds, type]);
  const metricTotal = slices.reduce((s, v) => s + v.amount, 0);

  const trendBuckets = useMemo(() => monthBuckets(period === "Yearly" ? new Date(year, 11, 1) : anchor, period === "Yearly" ? 12 : 6), [period, year, anchor]);
  const trend = useMemo(() => categoryTrend(all, accountIds, type, trendBuckets), [all, accountIds, type, trendBuckets]);

  const pace = useMemo(
    () => buildPace(current, previous, accountIds, type, period, range.from, previousRange.from),
    [current, previous, accountIds, type, period, range.from, previousRange.from]
  );

  const weekdays = useMemo(() => {
    const sums = [0, 0, 0, 0, 0, 0, 0];
    for (const t of current) {
      if (t.type !== type || !accountIds.has(t.accountId)) continue;
      sums[(new Date(t.date).getDay() + 6) % 7] += countedAmount(t);
    }
    return WEEKDAYS.map((label, i) => ({ label, value: sums[i] }));
  }, [current, accountIds, type]);

  const payees = useMemo(() => {
    const map = new Map<string, { name: string; amount: number; count: number }>();
    for (const t of current) {
      if (t.type !== type || !accountIds.has(t.accountId)) continue;
      const amount = countedAmount(t);
      if (amount <= 0) continue;
      const name = t.payee?.trim() || t.category?.name || "Unnamed";
      const key = name.toLowerCase();
      const entry = map.get(key) ?? { name, amount: 0, count: 0 };
      entry.amount += amount;
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [current, accountIds, type]);

  const byAccount = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of current) {
      if (t.type !== type || !accountIds.has(t.accountId)) continue;
      map.set(t.accountId, (map.get(t.accountId) ?? 0) + countedAmount(t));
    }
    return Array.from(map.entries())
      .map(([id, value]) => ({ label: accounts.find((a) => a.id === id)?.name ?? "Account", value }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [current, accountIds, type, accounts]);

  const days = Math.max(1, Math.round((Math.min(Date.now(), range.to.getTime()) - range.from.getTime()) / 86_400_000));
  const savingsRate = now.income > 0 ? now.net / now.income : null;

  function shift(delta: number) {
    setAnchor((d) => (period === "Yearly" ? (delta > 0 ? addYears(d, 1) : subYears(d, 1)) : delta > 0 ? addMonths(d, 1) : subMonths(d, 1)));
  }

  return (
    <div className="space-y-5">
      {/* Filters in one row above everything they drive. */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={metric}
          onChange={setMetric}
          options={[
            { value: "Expenses", label: "Spending" },
            { value: "Income", label: "Income" },
          ]}
        />
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: "Monthly", label: "Month" },
            { value: "Yearly", label: "Year" },
          ]}
        />
        <div className="ml-auto flex items-center gap-1 rounded-xl border border-line bg-surface/60 p-1">
          <Button variant="ghost" size="sm" className="!px-2" onClick={() => shift(-1)} aria-label="Previous period">
            <ChevronLeft size={16} />
          </Button>
          <span className="min-w-[130px] text-center text-sm font-semibold text-ink">{periodLabel}</span>
          <Button variant="ghost" size="sm" className="!px-2" onClick={() => shift(1)} aria-label="Next period">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      <ErrorText>{staticError}</ErrorText>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label="Income"
          value={now.income}
          currency={family.currency}
          icon={<TrendingUp size={16} />}
          accent="income"
          compact
          loading={isLoading}
          hint={<Delta current={now.income} previous={before.income} label={previousLabel} />}
        />
        <StatTile
          label="Spending"
          value={now.expense}
          currency={family.currency}
          icon={<TrendingDown size={16} />}
          accent="expense"
          compact
          loading={isLoading}
          hint={<Delta current={now.expense} previous={before.expense} label={previousLabel} invert />}
        />
        <StatTile
          label="Net saved"
          value={now.net}
          currency={family.currency}
          icon={<Wallet size={16} />}
          accent="brand"
          tone="auto"
          compact
          loading={isLoading}
          hint={savingsRate === null ? "No income recorded" : `${formatPercent(savingsRate)} of income kept`}
        />
        <StatTile
          label={metric === "Income" ? "Earned a day" : "Spent a day"}
          value={(metric === "Income" ? now.income : now.expense) / days}
          currency={family.currency}
          icon={<CalendarDays size={16} />}
          accent="info"
          compact
          loading={isLoading}
          hint={`${now.count} transaction${now.count === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-8"
          title="Cash flow"
          subtitle={period === "Yearly" ? `Each month of ${year}` : `Twelve months to ${format(anchor, "MMMM yyyy")}`}
          legend={
            <Legend
              items={[
                { label: "Income", color: palette.income },
                { label: "Spending", color: palette.expense },
                { label: "Net", color: palette.net, dashed: true },
              ]}
            />
          }
        >
          {isLoading ? <SkeletonRows rows={5} /> : <CashflowChart data={flow} currency={family.currency} height={300} />}
        </ChartCard>

        <div className="space-y-5 xl:col-span-4">
          {metric === "Expenses" && <MoneyUsed slices={slices} total={metricTotal} budgetTotal={budgetTotal} currency={family.currency} />}
          <ChartCard title={metric === "Income" ? "Where it came from" : "Where it went"} subtitle={periodLabel}>
            {isLoading ? (
              <SkeletonRows rows={3} />
            ) : metricTotal === 0 ? (
              <EmptyState
                title={`No ${metric === "Income" ? "income" : "spending"} recorded`}
                description="Add a transaction to see it broken down here."
                icon={<PieChartIcon size={20} />}
              />
            ) : (
              <CategoryPie
                slices={slices.map((s) => ({ ...s, fraction: s.amount / metricTotal }))}
                currency={family.currency}
                metricLabel={metric === "Income" ? "Earned" : "Spent"}
              />
            )}
          </ChartCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard className="xl:col-span-5" title="By category" subtitle={`${periodLabel} · change vs ${previousLabel}`}>
          {isLoading ? (
            <SkeletonRows rows={5} />
          ) : (
            <CategoryTable slices={slices} previous={previousSlices} total={metricTotal} currency={family.currency} metric={metric} />
          )}
        </ChartCard>
        <ChartCard
          className="xl:col-span-7"
          title="Category trend"
          subtitle={`Top categories, ${period === "Yearly" ? `each month of ${year}` : "last six months"}`}
          legend={<Legend items={trend.series.map((s) => ({ label: s.label, color: s.color }))} />}
        >
          {isLoading ? (
            <SkeletonRows rows={5} />
          ) : trend.series.length === 0 ? (
            <p className="text-sm text-ink-subtle">Nothing recorded yet.</p>
          ) : (
            <StackedBars data={trend.rows} series={trend.series} currency={family.currency} height={300} />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <ChartCard
          className="xl:col-span-7"
          title={metric === "Income" ? "Earning pace" : "Spending pace"}
          subtitle={`Running total through ${periodLabel}, against ${previousLabel}`}
          legend={
            <Legend
              items={[
                { label: periodLabel, color: metricColor },
                { label: previousLabel, color: palette.axis, dashed: true },
              ]}
            />
          }
        >
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : (
            <PaceChart data={pace} currentLabel={periodLabel} previousLabel={previousLabel} currency={family.currency} color={metricColor} />
          )}
        </ChartCard>
        <ChartCard className="xl:col-span-5" title="By day of the week" subtitle={periodLabel}>
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : (
            <SimpleBars data={weekdays} currency={family.currency} name={metric === "Income" ? "Income" : "Spending"} color={metricColor} height={260} />
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartCard title={metric === "Income" ? "Top sources" : "Top payees"} subtitle={periodLabel}>
          {isLoading ? <SkeletonRows rows={5} /> : <PayeeTable rows={payees} total={metricTotal} currency={family.currency} color={metricColor} />}
        </ChartCard>
        <ChartCard title="By account" subtitle={periodLabel}>
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : byAccount.length === 0 ? (
            <p className="text-sm text-ink-subtle">Nothing recorded in this period.</p>
          ) : (
            <SimpleBars
              data={byAccount}
              currency={family.currency}
              name={metric === "Income" ? "Income" : "Spending"}
              color={metricColor}
              layout="horizontal-bars"
              height={Math.max(160, byAccount.length * 40)}
            />
          )}
        </ChartCard>
      </div>

      <MonthlyTable flow={flow} currency={family.currency} loading={isLoading} />
    </div>
  );
}

/* ----------------------------------------------------------------- pieces */

function Delta({ current, previous, label, invert = false }: { current: number; previous: number; label: string; invert?: boolean }) {
  if (previous === 0 && current === 0) return <span>Nothing in {label} either</span>;
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return <span>Same as {label}</span>;
  const up = diff > 0;
  const good = invert ? !up : up;
  return (
    <span className={cn("flex items-center gap-1", good ? "text-income" : "text-expense")}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {previous === 0 ? "New" : formatPercent(Math.abs(diff) / previous)} vs {label}
    </span>
  );
}

function buildPace(
  current: Transaction[],
  previous: Transaction[],
  accountIds: Set<string>,
  type: "INCOME" | "EXPENSE",
  period: Period,
  from: Date,
  previousFrom: Date
) {
  const today = new Date();
  if (period === "Monthly") {
    const daysIn = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
    const prevDays = new Date(previousFrom.getFullYear(), previousFrom.getMonth() + 1, 0).getDate();
    const cur = new Array<number>(daysIn).fill(0);
    const prev = new Array<number>(Math.max(daysIn, prevDays)).fill(0);
    for (const t of current) if (t.type === type && accountIds.has(t.accountId)) cur[new Date(t.date).getDate() - 1] += countedAmount(t);
    for (const t of previous) if (t.type === type && accountIds.has(t.accountId)) prev[new Date(t.date).getDate() - 1] += countedAmount(t);
    const isThisMonth = from.getFullYear() === today.getFullYear() && from.getMonth() === today.getMonth();
    let a = 0;
    let b = 0;
    return Array.from({ length: daysIn }, (_, i) => {
      a += cur[i];
      b += prev[i] ?? 0;
      return { label: String(i + 1), current: isThisMonth && i + 1 > today.getDate() ? null : a, previous: i < prevDays ? b : null };
    });
  }
  const cur = new Array<number>(12).fill(0);
  const prev = new Array<number>(12).fill(0);
  for (const t of current) if (t.type === type && accountIds.has(t.accountId)) cur[new Date(t.date).getMonth()] += countedAmount(t);
  for (const t of previous) if (t.type === type && accountIds.has(t.accountId)) prev[new Date(t.date).getMonth()] += countedAmount(t);
  const isThisYear = from.getFullYear() === today.getFullYear();
  let a = 0;
  let b = 0;
  return cur.map((value, i) => {
    a += value;
    b += prev[i];
    return {
      label: new Date(2000, i, 1).toLocaleDateString(undefined, { month: "short" }),
      current: isThisYear && i > today.getMonth() ? null : a,
      previous: b,
    };
  });
}

/**
 * One bar of everything used in the period, a coloured segment per category. With a budget the bar is
 * the budget: the empty end is what's left, and spending past it fills the whole bar.
 */
function MoneyUsed({ slices, total, budgetTotal, currency }: { slices: CategoryTotal[]; total: number; budgetTotal: number; currency: string }) {
  const hasBudget = budgetTotal > 0;
  const scale = Math.max(hasBudget ? budgetTotal : total, total, 1);
  const over = hasBudget && total > budgetTotal;
  const usedPct = hasBudget ? (total / budgetTotal) * 100 : 100;

  return (
    <ChartCard title="Money used" subtitle={hasBudget ? "Against everything budgeted for the period" : "Set budgets to see this against your plan"}>
      <div className="space-y-2.5">
        <p className="text-xs text-ink-muted">
          <Money amount={total} currency={currency} className="text-lg font-bold text-ink" />
          {hasBudget && (
            <>
              {" of "}
              <Money amount={budgetTotal} currency={currency} /> budget
            </>
          )}
        </p>
        <div className="flex h-4 overflow-hidden rounded-md bg-surface-sunken">
          {slices.map((s) => (
            <div
              key={s.key}
              title={`${s.name}: ${formatCurrency(s.amount, currency)}`}
              className="h-full border-r-2 border-surface last:border-r-0"
              style={{ width: `${(s.amount / scale) * 100}%`, backgroundColor: s.color }}
            />
          ))}
        </div>
        {hasBudget && (
          <div className="flex justify-between text-xs font-semibold">
            <span className={over ? "text-expense" : "text-ink-subtle"}>{usedPct.toFixed(0)}% of budget used</span>
            <span className={over ? "text-expense" : "text-income"}>
              {over ? "Over by " : "Left "}
              <Money amount={Math.abs(budgetTotal - total)} currency={currency} />
            </span>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

function CategoryTable({
  slices,
  previous,
  total,
  currency,
  metric,
}: {
  slices: CategoryTotal[];
  previous: Map<string, number>;
  total: number;
  currency: string;
  metric: Metric;
}) {
  if (slices.length === 0) return <p className="text-sm text-ink-subtle">Nothing recorded in this period.</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
            <th className="px-1 pb-2">Category</th>
            <th className="px-1 pb-2 text-right">Share</th>
            <th className="px-1 pb-2 text-right">Amount</th>
            <th className="px-1 pb-2 text-right">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {slices.map((s) => {
            const share = total > 0 ? s.amount / total : 0;
            const before = previous.get(s.key) ?? 0;
            const diff = s.amount - before;
            const good = metric === "Income" ? diff >= 0 : diff <= 0;
            return (
              <tr key={s.key}>
                <td className="px-1 py-2.5">
                  <div className="flex items-center gap-2">
                    <Dot color={s.color} size={9} />
                    <span className="truncate font-medium text-ink">{s.name}</span>
                    <span className="text-2xs text-ink-subtle">{s.count}×</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
                    <div className="h-full rounded-full" style={{ width: `${share * 100}%`, backgroundColor: s.color }} />
                  </div>
                </td>
                <td className="tnum px-1 py-2.5 text-right text-ink-muted">{formatPercent(share)}</td>
                <td className="tnum px-1 py-2.5 text-right font-semibold text-ink">{formatCurrency(s.amount, currency)}</td>
                <td className={cn("tnum px-1 py-2.5 text-right text-xs font-semibold", before === 0 ? "text-ink-subtle" : good ? "text-income" : "text-expense")}>
                  {before === 0 ? "New" : `${diff >= 0 ? "+" : "−"}${formatPercent(Math.abs(diff) / before)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PayeeTable({ rows, total, currency, color }: { rows: { name: string; amount: number; count: number }[]; total: number; currency: string; color: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-subtle">Nothing recorded in this period.</p>;
  const max = rows[0].amount || 1;
  return (
    <ul className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.name} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3">
          <span className="text-xs font-bold text-ink-subtle">{i + 1}</span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{r.name}</span>
              <span className="shrink-0 text-2xs text-ink-subtle">
                {r.count}× · {total > 0 ? formatPercent(r.amount / total) : "—"}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
              <div className="h-full rounded-full" style={{ width: `${(r.amount / max) * 100}%`, backgroundColor: color }} />
            </div>
          </div>
          <span className="tnum text-sm font-semibold text-ink">{formatCurrency(r.amount, currency)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The cash-flow chart's numbers as a table — exact values, and the view for anyone not reading the chart. */
function MonthlyTable({ flow, currency, loading }: { flow: { full: string; income: number; expense: number; net: number }[]; currency: string; loading: boolean }) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Receipt size={16} className="text-brand-600" />
        <h3 className="text-sm font-semibold text-ink">Month by month</h3>
      </div>
      {loading ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                <th className="px-1 pb-2">Month</th>
                <th className="px-1 pb-2 text-right">Income</th>
                <th className="px-1 pb-2 text-right">Spending</th>
                <th className="px-1 pb-2 text-right">Net</th>
                <th className="px-1 pb-2 text-right">Saved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...flow].reverse().map((m) => (
                <tr key={m.full} className="hover:bg-surface-sunken/50">
                  <td className="px-1 py-2 font-medium text-ink">{m.full}</td>
                  <td className="tnum px-1 py-2 text-right text-ink">{formatCurrency(m.income, currency)}</td>
                  <td className="tnum px-1 py-2 text-right text-ink">{formatCurrency(m.expense, currency)}</td>
                  <td className={cn("tnum px-1 py-2 text-right font-semibold", m.net < 0 ? "text-expense" : m.net > 0 ? "text-income" : "text-ink-muted")}>
                    {formatCurrency(m.net, currency)}
                  </td>
                  <td className="tnum px-1 py-2 text-right text-ink-muted">{m.income > 0 ? formatPercent(m.net / m.income) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
