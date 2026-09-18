import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { addMonths, addYears, format, subMonths, subYears } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Filter as FilterIcon, Plus } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, Chip, ErrorText, Segmented } from "../components/ui";
import { Money } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Account, Category, Transaction } from "../api/types";
import { loadPrefs } from "../lib/prefs";
import { monthRange, yearRange } from "../lib/dateUtils";
import { DailyView } from "../components/transactions/DailyView";
import { CalendarView } from "../components/transactions/CalendarView";
import { MonthlyView } from "../components/transactions/MonthlyView";
import { TotalView } from "../components/transactions/TotalView";
import { FilterPanel } from "../components/transactions/FilterPanel";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";

type SubView = "Daily" | "Calendar" | "Monthly" | "Total";

const SUB_VIEW_OPTIONS: { value: SubView; label: string }[] = [
  { value: "Daily", label: "Daily" },
  { value: "Calendar", label: "Calendar" },
  { value: "Monthly", label: "Monthly" },
  { value: "Total", label: "Total" },
];

export function Transactions() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefs] = useState(loadPrefs);
  const [view, setView] = useState<SubView>(prefs.defaultView);
  const [anchor, setAnchor] = useState(() => new Date());

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [priorTransactions, setPriorTransactions] = useState<Transaction[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string> | null>(null);
  const [showFilter, setShowFilter] = useState(false);
  const [formTransaction, setFormTransaction] = useState<Transaction | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // The "Get the app" shortcut and the dashboard both link here with ?new=1 to jump straight
  // into the add-transaction flow.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowAddForm(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const range = view === "Monthly" ? yearRange(anchor.getFullYear()) : monthRange(anchor);
  const periodLabel = view === "Monthly" ? String(anchor.getFullYear()) : format(anchor, "MMMM yyyy");
  const isCurrentPeriod =
    view === "Monthly"
      ? anchor.getFullYear() === new Date().getFullYear()
      : anchor.getFullYear() === new Date().getFullYear() && anchor.getMonth() === new Date().getMonth();

  async function loadStatic() {
    try {
      const [accRes, catRes] = await Promise.all([
        api.get<Account[]>(`/families/${family.id}/accounts`),
        api.get<Category[]>(`/families/${family.id}/categories`),
      ]);
      setAccounts(accRes.data);
      setCategories(catRes.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load accounts or categories"));
    }
  }

  async function loadTransactions() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { from: range.from.toISOString(), to: range.to.toISOString(), limit: 1000 },
      });
      setTransactions(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load transactions"));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPriorTransactions() {
    if (!prefs.carryOver) {
      setPriorTransactions([]);
      return;
    }
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { to: range.from.toISOString(), limit: 1000 },
      });
      setPriorTransactions(res.data);
    } catch {
      setPriorTransactions([]);
    }
  }

  useEffect(() => {
    loadStatic().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  useEffect(() => {
    loadTransactions().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id, range.from.getTime(), range.to.getTime()]);

  useEffect(() => {
    loadPriorTransactions().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id, range.from.getTime(), prefs.carryOver]);

  // The account/personal scope toggle in the header (see Layout) narrows which accounts'
  // activity this hub considers, same as Dashboard's net-worth card does.
  const scopedAccounts = useMemo(
    () => (scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id)),
    [accounts, scope, user]
  );

  const accountIds = useMemo(
    () => selectedAccountIds ?? new Set(scopedAccounts.map((a) => a.id)),
    [selectedAccountIds, scopedAccounts]
  );

  const visibleTransactions = useMemo(
    () => transactions.filter((t) => accountIds.has(t.accountId)),
    [transactions, accountIds]
  );

  const historyForCarryOver = useMemo(
    () => [...priorTransactions, ...transactions],
    [priorTransactions, transactions]
  );

  const periodTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of visibleTransactions) {
      if (t.type === "INCOME") income += t.amount;
      else if (t.type === "EXPENSE") expense += t.amount;
    }
    return { income, expense, net: income - expense };
  }, [visibleTransactions]);

  function goPrev() {
    setAnchor((d) => (view === "Monthly" ? subYears(d, 1) : subMonths(d, 1)));
  }
  function goNext() {
    setAnchor((d) => (view === "Monthly" ? addYears(d, 1) : addMonths(d, 1)));
  }
  function goToday() {
    setAnchor(new Date());
  }

  function refresh() {
    loadTransactions();
    loadPriorTransactions();
  }

  return (
    <div className="relative space-y-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} options={SUB_VIEW_OPTIONS} />

        <div className="relative flex items-center gap-2">
          {selectedAccountIds !== null && (
            <Chip selected onClick={() => setSelectedAccountIds(null)}>
              {selectedAccountIds.size} account{selectedAccountIds.size === 1 ? "" : "s"} ✕
            </Chip>
          )}
          <div className="relative">
            <Button variant="ghost" size="sm" icon={<FilterIcon size={15} />} onClick={() => setShowFilter((v) => !v)}>
              Filter
            </Button>
            {showFilter && (
              <FilterPanel
                accounts={scopedAccounts}
                transactions={transactions}
                selectedAccountIds={selectedAccountIds}
                onChange={setSelectedAccountIds}
                currency={family.currency}
                onClose={() => setShowFilter(false)}
              />
            )}
          </div>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="!px-2"
            onClick={goPrev}
            aria-label="Previous period"
          >
            <ChevronLeft size={18} />
          </Button>

          <button
            type="button"
            onClick={goToday}
            disabled={isCurrentPeriod}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold text-ink transition disabled:cursor-default disabled:text-ink hover:enabled:bg-surface-sunken"
          >
            {periodLabel}
            {!isCurrentPeriod && <CalendarDays size={13} className="text-brand-500" />}
          </button>

          <Button
            variant="ghost"
            size="sm"
            className="!px-2"
            onClick={goNext}
            aria-label="Next period"
          >
            <ChevronRight size={18} />
          </Button>
        </div>

        <div className="mb-5 grid grid-cols-3 gap-3 rounded-xl bg-surface-sunken/60 p-3 text-center sm:gap-6 sm:px-6">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Income</p>
            <p className="tnum mt-1 text-sm font-bold text-income sm:text-base">
              <Money amount={periodTotals.income} currency={family.currency} />
            </p>
          </div>
          <div className="border-x border-line">
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Expenses</p>
            <p className="tnum mt-1 text-sm font-bold text-expense sm:text-base">
              <Money amount={periodTotals.expense} currency={family.currency} />
            </p>
          </div>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Net</p>
            <p className="tnum mt-1 text-sm font-bold text-ink sm:text-base">
              <Money amount={periodTotals.net} currency={family.currency} signed />
            </p>
          </div>
        </div>

        <ErrorText>{error}</ErrorText>

        {view === "Daily" && (
          <DailyView
            transactions={visibleTransactions}
            historyForCarryOver={historyForCarryOver}
            accounts={scopedAccounts}
            accountIds={accountIds}
            periodStart={range.from}
            currency={family.currency}
            carryOverEnabled={prefs.carryOver}
            isLoading={isLoading}
            onRowClick={setFormTransaction}
          />
        )}
        {view === "Calendar" && (
          <CalendarView
            monthDate={anchor}
            transactions={visibleTransactions}
            historyForCarryOver={historyForCarryOver}
            accounts={scopedAccounts}
            accountIds={accountIds}
            periodStart={range.from}
            currency={family.currency}
            carryOverEnabled={prefs.carryOver}
            weekStart={prefs.weekStart}
            isLoading={isLoading}
            onRowClick={setFormTransaction}
          />
        )}
        {view === "Monthly" && (
          <MonthlyView
            year={anchor.getFullYear()}
            transactions={visibleTransactions}
            historyForCarryOver={historyForCarryOver}
            accounts={scopedAccounts}
            accountIds={accountIds}
            currency={family.currency}
            carryOverEnabled={prefs.carryOver}
            weekStart={prefs.weekStart}
            isLoading={isLoading}
          />
        )}
        {view === "Total" && (
          <TotalView
            familyId={family.id}
            periodLabel={periodLabel}
            periodYear={anchor.getFullYear()}
            periodMonth={anchor.getMonth() + 1}
            transactions={visibleTransactions}
            historyForCarryOver={historyForCarryOver}
            accounts={scopedAccounts}
            accountIds={accountIds}
            periodStart={range.from}
            currency={family.currency}
            carryOverEnabled={prefs.carryOver}
            isLoading={isLoading}
          />
        )}
      </Card>

      <button
        type="button"
        onClick={() => setShowAddForm(true)}
        aria-label="Add transaction"
        className="brand-gradient safe-bottom fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-glow transition duration-200 ease-swift hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6"
      >
        <Plus size={24} />
      </button>

      {(showAddForm || formTransaction) && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          transaction={formTransaction}
          onClose={() => {
            setShowAddForm(false);
            setFormTransaction(null);
          }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
