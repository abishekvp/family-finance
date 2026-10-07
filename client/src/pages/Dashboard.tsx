import { lazy, Suspense, useMemo, useState, type ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, ChevronRight, HandCoins, PiggyBank, Plus, Repeat, Sparkles, Target, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { subMonths } from "date-fns";
import { useAuth } from "../context/AuthContext";
import { Button, Card, Dot, ErrorText, ProgressBar, SkeletonRows, cn } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Budget, Goal, RecurringTransaction, Transaction } from "../api/types";
import { formatCurrency, formatPercent, humanizeEnum, safePercent } from "../lib/format";
import { monthRange } from "../lib/dateUtils";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";
import { countedAmount, countsTowardTotals, isFamilyTransfer } from "../lib/transactionTotals";
import { useFamilyData, useYearTransactions } from "../context/FamilyDataContext";
import { useCachedGet } from "../lib/sessionCache";
import { cashflow, monthBuckets } from "../lib/analytics";
import { ChartCard, Legend, useChartPalette } from "../components/chartKit";
import { budgetName } from "../lib/budgets";
import { formatDayShort } from "../lib/recurring";
import { isPerson, isWriteOff, lendingFlow, lendingTotals } from "../lib/lending";
import { formatTime } from "../lib/dateUtils";

const RECENT_ROWS = 8;

// The charting library is the biggest download in the app: the figures paint first, the chart follows.
const CashflowChart = lazy(() => import("../components/charts").then((m) => ({ default: m.CashflowChart })));

// The at-a-glance overview. Full management lives on each section's own page.
export function Dashboard() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const palette = useChartPalette();
  const { accounts, sharedAccounts, categories, isLoadingStatic, staticError, invalidateYear, refreshAccounts } = useFamilyData();
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const now = useMemo(() => new Date(), []);
  const thisMonth = useMemo(() => monthRange(now), [now]);
  const lastMonth = useMemo(() => monthRange(subMonths(now, 1)), [now]);

  // Six months of cash flow can reach into last year; both come from the shared per-year cache.
  const thisYear = useYearTransactions(now.getFullYear());
  const lastYear = useYearTransactions(now.getFullYear() - 1);
  const all = useMemo(() => [...lastYear.data, ...thisYear.data], [thisYear.data, lastYear.data]);

  const budgetsQuery = useCachedGet<Budget[]>(`/families/${family.id}/budgets`, { year: now.getFullYear(), month: now.getMonth() + 1 }, { fallback: [] });
  const goalsQuery = useCachedGet<Goal[]>(`/families/${family.id}/goals`, undefined, { fallback: [] });
  // Repeating payments carry payees, which are sealed for an encrypted family: kept in memory only then.
  const recurringQuery = useCachedGet<RecurringTransaction[]>(`/families/${family.id}/recurring`, undefined, {
    fallback: [],
    sensitive: family.encryptionEnabled,
  });

  const isLoading = isLoadingStatic || thisYear.isLoading || lastYear.isLoading;

  function refresh(saved?: Transaction) {
    invalidateYear(now.getFullYear());
    if (saved) invalidateYear(new Date(saved.date).getFullYear());
    budgetsQuery.reload();
    refreshAccounts().catch(() => undefined);
  }

  // The family's view takes in the accounts members share with the family too.
  const visibleAccounts = useMemo(
    () => (scope === "family" ? [...accounts, ...sharedAccounts] : accounts.filter((a) => a.owner?.id === user!.id)),
    [accounts, sharedAccounts, scope, user]
  );
  const visibleAccountIds = useMemo(() => new Set(visibleAccounts.map((a) => a.id)), [visibleAccounts]);
  // What's in your own accounts: lending takes money out of them; what's owed is shown alongside.
  const balanceAccounts = useMemo(() => visibleAccounts.filter((a) => !isPerson(a)), [visibleAccounts]);
  const balance = balanceAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const lending = useMemo(() => lendingTotals(visibleAccounts.filter(isPerson)), [visibleAccounts]);

  function summarize(from: Date, to: Date) {
    let income = 0;
    let expense = 0;
    for (const t of all) {
      const at = new Date(t.date);
      if (at < from || at >= to || !visibleAccountIds.has(t.accountId) || !countsTowardTotals(t)) continue;
      if (t.type === "INCOME") income += countedAmount(t);
      else if (t.type === "EXPENSE") expense += countedAmount(t);
    }
    return { income, expense, net: income - expense };
  }
  const thisMonthTotals = useMemo(() => summarize(thisMonth.from, thisMonth.to), [all, visibleAccountIds, thisMonth]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastMonthTotals = useMemo(() => summarize(lastMonth.from, lastMonth.to), [all, visibleAccountIds, lastMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const flowBuckets = useMemo(() => monthBuckets(now, 6), [now]);
  const flow = useMemo(() => cashflow(all, visibleAccountIds, flowBuckets), [all, visibleAccountIds, flowBuckets]);

  const recent = useMemo(
    () =>
      all
        .filter((t) => visibleAccountIds.has(t.accountId) || (t.transferToAccountId && visibleAccountIds.has(t.transferToAccountId)))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .slice(0, RECENT_ROWS),
    [all, visibleAccountIds]
  );

  const budgets = useMemo(() => {
    const relevant = scope === "family" ? (budgetsQuery.data ?? []).filter((b) => b.ownerId === null) : budgetsQuery.data ?? [];
    return relevant.slice().sort((a, b) => safePercent(b.spent, b.amount) - safePercent(a.spent, a.amount));
  }, [budgetsQuery.data, scope]);
  const budgetTotals = budgets.reduce((acc, b) => ({ amount: acc.amount + b.amount, spent: acc.spent + b.spent }), { amount: 0, spent: 0 });

  const goals = useMemo(() => {
    const relevant = scope === "family" ? (goalsQuery.data ?? []).filter((g) => g.ownerId === null) : goalsQuery.data ?? [];
    return relevant.filter((g) => !g.isCompleted).sort((a, b) => b.progress - a.progress).slice(0, 4);
  }, [goalsQuery.data, scope]);

  const upcoming = useMemo(() => {
    const horizon = new Date(now.getTime() + 30 * 86_400_000);
    return (recurringQuery.data ?? [])
      .filter((r) => r.isActive && new Date(`${r.nextDate}T00:00:00`) <= horizon)
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate))
      .slice(0, 5);
  }, [recurringQuery.data, now]);

  const people = useMemo(() => new Set(accounts.filter(isPerson).map((a) => a.id)), [accounts]);
  const ownAccounts = useMemo(
    () => visibleAccounts.filter((a) => !isPerson(a)).sort((a, b) => Math.abs(b.balance ?? 0) - Math.abs(a.balance ?? 0)),
    [visibleAccounts]
  );

  const firstName = user!.name.split(" ")[0];
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const monthLabel = now.toLocaleDateString(undefined, { month: "long" });
  const scopeLabel = scope === "family" ? family.name : "your personal accounts";

  function deltaHint(current: number, previous: number, invert = false) {
    if (previous === 0 && current === 0) return null;
    const diff = current - previous;
    const isUp = diff > 0;
    const good = invert ? !isUp : isUp;
    if (Math.abs(diff) < 0.01) return <span className="text-ink-subtle">Flat vs last month</span>;
    const changePct = formatPercent(previous === 0 ? 1 : Math.abs(diff) / Math.abs(previous));
    return (
      <span className={good ? "flex items-center gap-1 text-income" : "flex items-center gap-1 text-expense"}>
        {isUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
        {changePct} vs last month
      </span>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
            {greeting}, {firstName}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Here is how {scopeLabel} looks in {monthLabel}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/accounts">
            <Button variant="secondary">Manage accounts</Button>
          </Link>
          <Button icon={<Plus size={16} />} onClick={() => setShowAddTransaction(true)}>
            Add transaction
          </Button>
        </div>
      </div>

      <ErrorText>{staticError}</ErrorText>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          label={scope === "family" ? "Family balance" : "Your balance"}
          value={balance}
          currency={family.currency}
          icon={<Wallet size={16} />}
          accent="brand"
          tone="auto"
          compact
          loading={isLoading}
          hint={
            lending.owedToYou > 0 || lending.youOwe > 0
              ? [
                  lending.owedToYou > 0 ? `${formatCurrency(lending.owedToYou, family.currency)} owed to you` : null,
                  lending.youOwe > 0 ? `${formatCurrency(lending.youOwe, family.currency)} you owe` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : `Across ${balanceAccounts.length} account${balanceAccounts.length === 1 ? "" : "s"}`
          }
        />
        <StatTile
          label="Income this month"
          value={thisMonthTotals.income}
          currency={family.currency}
          icon={<TrendingUp size={16} />}
          accent="income"
          compact
          loading={isLoading}
          hint={deltaHint(thisMonthTotals.income, lastMonthTotals.income)}
        />
        <StatTile
          label="Spent this month"
          value={thisMonthTotals.expense}
          currency={family.currency}
          icon={<TrendingDown size={16} />}
          accent="expense"
          compact
          loading={isLoading}
          hint={deltaHint(thisMonthTotals.expense, lastMonthTotals.expense, true)}
        />
        <StatTile
          label="Net this month"
          value={thisMonthTotals.net}
          currency={family.currency}
          icon={<Sparkles size={16} />}
          accent="info"
          tone="auto"
          compact
          loading={isLoading}
          hint={deltaHint(thisMonthTotals.net, lastMonthTotals.net)}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="space-y-5 xl:col-span-8">
          <ChartCard
            title="Cash flow"
            subtitle="Last six months"
            actions={<SectionLink to="/stats">Insights</SectionLink>}
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
            {isLoading ? (
              <SkeletonRows rows={5} />
            ) : (
              <Suspense fallback={<div style={{ height: 280 }} />}>
                <CashflowChart data={flow} currency={family.currency} height={280} />
              </Suspense>
            )}
          </ChartCard>

          <Card padded={false}>
            <div className="flex items-center justify-between px-5 pb-3 pt-5">
              <h3 className="text-sm font-semibold text-ink">Recent transactions</h3>
              <SectionLink to="/transactions">View all</SectionLink>
            </div>
            {isLoading ? (
              <div className="px-5 pb-5">
                <SkeletonRows rows={5} />
              </div>
            ) : recent.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-ink-subtle">No transactions yet. Add your first one above.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-y border-line bg-surface-sunken/50 text-left text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                      <th className="px-5 py-2">Date</th>
                      <th className="px-3 py-2">Description</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-5 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {recent.map((t) => (
                      <tr key={t.id} onClick={() => setEditingTransaction(t)} className="cursor-pointer transition-colors hover:bg-surface-sunken/60">
                        <td className="whitespace-nowrap px-5 py-2.5 text-ink-muted">
                          {new Date(t.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                          <span className="ml-1.5 text-2xs text-ink-subtle">{formatTime(t.date)}</span>
                        </td>
                        <td className="max-w-[260px] truncate px-3 py-2.5 font-medium text-ink">
                          {t.payee || t.category?.name || (t.type === "TRANSFER" ? "Transfer" : "Uncategorized")}
                        </td>
                        <td className="px-3 py-2.5">
                          {lendingFlow(t, people) !== null ? (
                            <span className="flex items-center gap-1.5 text-ink-muted">
                              <HandCoins size={13} /> Lend &amp; borrow
                            </span>
                          ) : t.type === "TRANSFER" ? (
                            <span className="flex items-center gap-1.5 text-ink-muted">
                              <ArrowLeftRight size={13} /> Transfer
                            </span>
                          ) : isWriteOff(t) ? (
                            <span className="text-ink-muted">Written off</span>
                          ) : isFamilyTransfer(t) ? (
                            <span className="text-ink-muted">Family transfer</span>
                          ) : t.category ? (
                            <span className="flex items-center gap-1.5 text-ink-muted">
                              <Dot color={t.category.color} size={8} />
                              {t.category.name}
                            </span>
                          ) : (
                            <span className="text-warn">Uncategorized</span>
                          )}
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2.5 text-ink-muted">
                          {t.account.name}
                          {t.type === "TRANSFER" && t.transferToAccount ? ` → ${t.transferToAccount.name}` : ""}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold">
                          <Money
                            amount={lendingFlow(t, people) ?? (t.type === "EXPENSE" ? -t.amount : t.amount)}
                            currency={t.account.currency}
                            signed={t.type !== "TRANSFER" || lendingFlow(t, people) !== null}
                            tone={t.type === "TRANSFER" || countedAmount(t) === 0 ? "muted" : t.type === "INCOME" ? "income" : "expense"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5 xl:col-span-4">
          <SideCard
            title="Budget health"
            subtitle={budgets.length > 0 ? `${monthLabel} · ${formatCurrency(budgetTotals.spent, family.currency)} of ${formatCurrency(budgetTotals.amount, family.currency)}` : monthLabel}
            icon={<PiggyBank size={16} />}
            link={<SectionLink to="/budgets">Manage</SectionLink>}
          >
            {budgetsQuery.isLoading ? (
              <SkeletonRows rows={3} />
            ) : budgets.length === 0 ? (
              <p className="text-sm text-ink-subtle">No budgets this month. Set one under Budgets.</p>
            ) : (
              <ul className="divide-y divide-line">
                {budgets.map((b) => (
                  <BudgetRow key={b.id} budget={b} currency={family.currency} />
                ))}
              </ul>
            )}
          </SideCard>

          {upcoming.length > 0 && (
            <SideCard title="Coming up" subtitle="Repeating payments in the next 30 days" icon={<Repeat size={16} />} link={<SectionLink to="/recurring">All</SectionLink>}>
              <ul className="divide-y divide-line">
                {upcoming.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <Dot color={r.category?.color ?? "#94A3B8"} size={9} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{r.payee || r.category?.name || "Repeating payment"}</p>
                      <p className="text-xs text-ink-subtle">
                        {formatDayShort(r.nextDate)} · {humanizeEnum(r.frequency)}
                      </p>
                    </div>
                    <Money
                      amount={r.type === "EXPENSE" ? -r.amount : r.amount}
                      currency={r.account.currency}
                      signed
                      tone={r.type === "EXPENSE" ? "expense" : "income"}
                      className="text-sm font-semibold"
                    />
                  </li>
                ))}
              </ul>
            </SideCard>
          )}

          {goals.length > 0 && (
            <SideCard title="Savings goals" subtitle="In progress" icon={<Target size={16} />} link={<SectionLink to="/goals">Manage</SectionLink>}>
              <ul className="space-y-3.5">
                {goals.map((g) => (
                  <li key={g.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-ink">{g.name}</span>
                      <span className="tnum shrink-0 text-xs font-semibold text-ink-muted">{Math.round(g.progress * 100)}%</span>
                    </div>
                    <ProgressBar value={g.progress} />
                    <p className="mt-1 text-xs text-ink-subtle">
                      <Money amount={g.saved} currency={family.currency} /> of <Money amount={g.targetAmount} currency={family.currency} />
                    </p>
                  </li>
                ))}
              </ul>
            </SideCard>
          )}

          <SideCard title="Accounts" subtitle={`${ownAccounts.length} account${ownAccounts.length === 1 ? "" : "s"}`} icon={<Wallet size={16} />} link={<SectionLink to="/accounts">Manage</SectionLink>}>
            {isLoadingStatic ? (
              <SkeletonRows rows={3} />
            ) : (
              <ul className="divide-y divide-line">
                {ownAccounts.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                      <p className="text-xs text-ink-subtle">
                        {humanizeEnum(a.type)} · {a.owner ? "Personal" : "Family"}
                      </p>
                    </div>
                    <Money amount={a.balance ?? 0} currency={a.currency} tone={(a.balance ?? 0) < 0 ? "expense" : undefined} className="text-sm font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </SideCard>
        </div>
      </div>

      {(showAddTransaction || editingTransaction) && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          transaction={editingTransaction}
          onClose={() => {
            setShowAddTransaction(false);
            setEditingTransaction(null);
          }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-0.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
      {children}
      <ChevronRight size={14} />
    </Link>
  );
}

function SideCard({ title, subtitle, icon, link, children }: { title: string; subtitle?: string; icon: ReactNode; link?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-600">{icon}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {subtitle && <p className="truncate text-xs text-ink-subtle">{subtitle}</p>}
          </div>
        </div>
        {link}
      </div>
      {children}
    </Card>
  );
}

/** One budget as a row: name and its share used, the bar, then what's spent and what's left. */
function BudgetRow({ budget: b, currency }: { budget: Budget; currency: string }) {
  const pct = b.amount > 0 ? (b.spent / b.amount) * 100 : 0;
  const over = b.spent > b.amount;
  const near = !over && pct >= 85;
  return (
    <li className="py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Dot color={b.category.color} size={9} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{budgetName(b)}</span>
        <span
          className={cn(
            "tnum shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold",
            over ? "bg-expense-soft text-expense" : near ? "bg-warn-soft text-warn" : "bg-surface-sunken text-ink-muted"
          )}
        >
          {pct.toFixed(0)}%
        </span>
      </div>
      <ProgressBar value={pct / 100} tone={over ? "expense" : near ? "warn" : "brand"} />
      <div className="mt-1.5 flex justify-between gap-2 text-xs">
        <span className="tnum text-ink-subtle">
          {formatCurrency(b.spent, currency)} of {formatCurrency(b.amount, currency)}
        </span>
        <span className={cn("tnum font-semibold", over ? "text-expense" : "text-ink-muted")}>
          {over ? `${formatCurrency(b.spent - b.amount, currency)} over` : `${formatCurrency(b.amount - b.spent, currency)} left`}
        </span>
      </div>
    </li>
  );
}
