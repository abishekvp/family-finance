import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  PiggyBank,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { subMonths } from "date-fns";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, CardHeader, Dot, EmptyState, ErrorText, ProgressBar, SkeletonRows } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Account, Budget, Category, Transaction } from "../api/types";
import { formatPercent, safePercent } from "../lib/format";
import { monthRange } from "../lib/dateUtils";
import { TransactionRow } from "../components/transactions/TransactionRow";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";

// A genuine at-a-glance overview. Full account management lives on Accounts.tsx and the full
// transaction list/filters/period views live on Transactions.tsx.
export function Dashboard() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [monthTransactions, setMonthTransactions] = useState<Transaction[]>([]);
  const [lastMonthTransactions, setLastMonthTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const now = useMemo(() => new Date(), []);
  const thisMonth = useMemo(() => monthRange(now), [now]);
  const lastMonth = useMemo(() => monthRange(subMonths(now, 1)), [now]);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsRes, categoriesRes, recentRes, monthRes, lastMonthRes, budgetsRes] = await Promise.all([
        api.get<Account[]>(`/families/${family.id}/accounts`),
        api.get<Category[]>(`/families/${family.id}/categories`),
        api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { limit: 6 } }),
        api.get<Transaction[]>(`/families/${family.id}/transactions`, {
          params: { from: thisMonth.from.toISOString(), to: thisMonth.to.toISOString(), limit: 1000 },
        }),
        api.get<Transaction[]>(`/families/${family.id}/transactions`, {
          params: { from: lastMonth.from.toISOString(), to: lastMonth.to.toISOString(), limit: 1000 },
        }),
        api
          .get<Budget[]>(`/families/${family.id}/budgets`, {
            params: { year: now.getFullYear(), month: now.getMonth() + 1 },
          })
          .catch(() => ({ data: [] as Budget[] })),
      ]);
      setAccounts(accountsRes.data);
      setCategories(categoriesRes.data);
      setRecentTransactions(recentRes.data);
      setMonthTransactions(monthRes.data);
      setLastMonthTransactions(lastMonthRes.data);
      setBudgets(budgetsRes.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load your dashboard"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  const visibleAccounts = useMemo(
    () => (scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id)),
    [accounts, scope, user]
  );
  const visibleAccountIds = useMemo(() => new Set(visibleAccounts.map((a) => a.id)), [visibleAccounts]);
  const netWorth = visibleAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);

  function summarize(transactions: Transaction[]) {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (!visibleAccountIds.has(t.accountId)) continue;
      if (t.type === "INCOME") income += t.amount;
      else if (t.type === "EXPENSE") expense += t.amount;
    }
    return { income, expense, net: income - expense };
  }

  const thisMonthTotals = useMemo(() => summarize(monthTransactions), [monthTransactions, visibleAccountIds]);
  const lastMonthTotals = useMemo(() => summarize(lastMonthTransactions), [lastMonthTransactions, visibleAccountIds]);

  const topCategories = useMemo(() => {
    const totals = new Map<string, { name: string; color: string; amount: number }>();
    for (const t of monthTransactions) {
      if (t.type !== "EXPENSE" || !visibleAccountIds.has(t.accountId)) continue;
      const key = t.categoryId ?? "uncategorized";
      const entry = totals.get(key) ?? {
        name: t.category?.name ?? "Uncategorized",
        color: t.category?.color ?? "#94A3B8",
        amount: 0,
      };
      entry.amount += t.amount;
      totals.set(key, entry);
    }
    return Array.from(totals.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [monthTransactions, visibleAccountIds]);
  const topCategoriesTotal = topCategories.reduce((s, c) => s + c.amount, 0);

  const budgetHighlights = useMemo(() => {
    const relevant = scope === "family" ? budgets.filter((b) => b.ownerId === null) : budgets;
    return relevant
      .slice()
      .sort((a, b) => safePercent(b.spent, b.amount) - safePercent(a.spent, a.amount))
      .slice(0, 4);
  }, [budgets, scope]);

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
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          {greeting}, {firstName}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Here is how {scopeLabel} looked in {monthLabel}.
        </p>
      </div>

      <ErrorText>{error}</ErrorText>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile
          label={scope === "family" ? "Family net worth" : "Your net worth"}
          value={netWorth}
          currency={family.currency}
          icon={<Wallet size={16} />}
          accent="brand"
          compact
          loading={isLoading}
          hint={`Across ${visibleAccounts.length} account${visibleAccounts.length === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Income this month"
          value={thisMonthTotals.income}
          currency={family.currency}
          icon={<TrendingUp size={16} />}
          accent="income"
          tone="auto"
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Top spending" subtitle={monthLabel} icon={<PiggyBank size={17} />} />
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : topCategories.length === 0 ? (
            <EmptyState title="No expenses yet" description="Categorized spending will show up here." />
          ) : (
            <ul className="space-y-3.5">
              {topCategories.map((c) => (
                <li key={c.name}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                      <Dot color={c.color} />
                      <span className="truncate">{c.name}</span>
                    </span>
                    <span className="tnum shrink-0 font-semibold">
                      <Money amount={c.amount} currency={family.currency} />
                    </span>
                  </div>
                  <ProgressBar value={safePercent(c.amount, topCategoriesTotal) / 100} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Recent transactions"
            icon={<Wallet size={17} />}
            actions={
              <Link
                to="/transactions"
                className="flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700"
              >
                View all
                <ArrowRight size={14} />
              </Link>
            }
          />
          {isLoading ? (
            <SkeletonRows rows={5} />
          ) : recentTransactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              description="Add your first transaction to see it here."
              action={
                <Button size="sm" icon={<Plus size={15} />} onClick={() => setShowAddTransaction(true)}>
                  Add transaction
                </Button>
              }
            />
          ) : (
            <div className="divide-y divide-line">
              {recentTransactions.map((t) => (
                <TransactionRow key={t.id} transaction={t} onClick={() => setEditingTransaction(t)} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {budgetHighlights.length > 0 && (
        <Card>
          <CardHeader
            title="Budget health"
            subtitle={monthLabel}
            icon={<PiggyBank size={17} />}
            actions={
              <Link to="/settings" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                Manage budgets
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {budgetHighlights.map((b) => {
              const pct = b.amount > 0 ? b.spent / b.amount : 0;
              const over = b.spent > b.amount;
              return (
                <div key={b.id}>
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-ink">
                    <Dot color={b.category.color} />
                    <span className="truncate">{b.category.name}</span>
                  </div>
                  <ProgressBar value={pct} tone={over ? "expense" : "brand"} className="mb-1.5" />
                  <p className={over ? "text-xs text-expense" : "text-xs text-ink-subtle"}>
                    <Money amount={b.spent} currency={family.currency} /> of{" "}
                    <Money amount={b.amount} currency={family.currency} />
                  </p>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button icon={<Plus size={16} />} onClick={() => setShowAddTransaction(true)}>
          Add transaction
        </Button>
        <Link to="/accounts">
          <Button variant="secondary">Manage accounts</Button>
        </Link>
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
          onSaved={load}
        />
      )}
    </div>
  );
}
