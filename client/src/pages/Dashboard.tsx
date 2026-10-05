import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowDownRight,
  ArrowUpRight,
  PiggyBank,
  Plus,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { subMonths } from "date-fns";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, CardHeader, Dot, ErrorText, ProgressBar } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Budget, Goal, Transaction } from "../api/types";
import { formatPercent, safePercent } from "../lib/format";
import { monthRange } from "../lib/dateUtils";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";
import { countedAmount, countsTowardTotals } from "../lib/transactionTotals";
import { useFamilyData, useYearTransactions } from "../context/FamilyDataContext";

// A genuine at-a-glance overview. Full account management lives on Accounts.tsx and the full
// transaction list/filters/period views live on Transactions.tsx.
export function Dashboard() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();

  // Accounts, categories and full-year transactions come from the shared cache (see
  // FamilyDataContext) so opening Dashboard after Transactions or Insights doesn't re-fetch them.
  const { accounts, categories, isLoadingStatic, staticError, invalidateYear } = useFamilyData();
  
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoadingExtras, setIsLoadingExtras] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  const now = useMemo(() => new Date(), []);
  const thisMonth = useMemo(() => monthRange(now), [now]);
  const lastMonth = useMemo(() => monthRange(subMonths(now, 1)), [now]);

  const { data: thisYearTransactions, isLoading: isLoadingThisYear } = useYearTransactions(now.getFullYear());
  const lastMonthYear = lastMonth.from.getFullYear();
  const { data: lastMonthYearTransactions, isLoading: isLoadingLastMonthYear } = useYearTransactions(lastMonthYear);

  const monthTransactions = useMemo(
    () => thisYearTransactions.filter((t) => new Date(t.date) >= thisMonth.from && new Date(t.date) < thisMonth.to),
    [thisYearTransactions, thisMonth]
  );
  const lastMonthTransactions = useMemo(() => {
    const source = lastMonthYear === now.getFullYear() ? thisYearTransactions : lastMonthYearTransactions;
    return source.filter((t) => new Date(t.date) >= lastMonth.from && new Date(t.date) < lastMonth.to);
  }, [thisYearTransactions, lastMonthYearTransactions, lastMonthYear, now, lastMonth]);

  async function loadExtras() {
    setIsLoadingExtras(true);
    setError(null);
    try {
      const [, budgetsRes, goalsRes] = await Promise.all([
        Promise.resolve({ data: [] as Transaction[] }),
        api
          .get<Budget[]>(`/families/${family.id}/budgets`, {
            params: { year: now.getFullYear(), month: now.getMonth() + 1 },
          })
          .catch(() => ({ data: [] as Budget[] })),
        api.get<Goal[]>(`/families/${family.id}/goals`).catch(() => ({ data: [] as Goal[] })),
      ]);
      
      setBudgets(budgetsRes.data);
      setGoals(goalsRes.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load your dashboard"));
    } finally {
      setIsLoadingExtras(false);
    }
  }

  useEffect(() => {
    loadExtras().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  const isLoading = isLoadingStatic || isLoadingExtras || isLoadingThisYear || isLoadingLastMonthYear;

  function refresh(saved?: Transaction) {
    invalidateYear(now.getFullYear());
    if (lastMonthYear !== now.getFullYear()) invalidateYear(lastMonthYear);
    if (saved) invalidateYear(new Date(saved.date).getFullYear());
    loadExtras();
  }

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
      if (!visibleAccountIds.has(t.accountId) || !countsTowardTotals(t)) continue;
      if (t.type === "INCOME") income += countedAmount(t);
      else if (t.type === "EXPENSE") expense += countedAmount(t);
    }
    return { income, expense, net: income - expense };
  }

  const thisMonthTotals = useMemo(() => summarize(monthTransactions), [monthTransactions, visibleAccountIds]);
  const lastMonthTotals = useMemo(() => summarize(lastMonthTransactions), [lastMonthTransactions, visibleAccountIds]);

  

  const budgetHighlights = useMemo(() => {
    const relevant = scope === "family" ? budgets.filter((b) => b.ownerId === null) : budgets;
    return relevant
      .slice()
      .sort((a, b) => safePercent(b.spent, b.amount) - safePercent(a.spent, a.amount))
      .slice(0, 4);
  }, [budgets, scope]);

  const goalHighlights = useMemo(() => {
    const relevant = scope === "family" ? goals.filter((g) => g.ownerId === null) : goals;
    return relevant
      .filter((g) => !g.isCompleted)
      .slice()
      .sort((a, b) => b.progress - a.progress)
      .slice(0, 4);
  }, [goals, scope]);

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

      <ErrorText>{error || staticError}</ErrorText>

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
                    <span className="truncate">{b.name?.trim() || b.category.name}</span>
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

      {goalHighlights.length > 0 && (
        <Card>
          <CardHeader
            title="Savings goals"
            subtitle="In progress"
            icon={<Target size={17} />}
            actions={
              <Link to="/settings" className="text-sm font-semibold text-brand-600 hover:text-brand-700">
                Manage goals
              </Link>
            }
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {goalHighlights.map((g) => (
              <div key={g.id}>
                <div className="mb-1.5 truncate text-sm font-medium text-ink">{g.name}</div>
                <ProgressBar value={g.progress} className="mb-1.5" />
                <p className="text-xs text-ink-subtle">
                  <Money amount={g.saved} currency={family.currency} /> of{" "}
                  <Money amount={g.targetAmount} currency={family.currency} />
                </p>
              </div>
            ))}
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
          onSaved={refresh}
        />
      )}
    </div>
  );
}




