import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addMonths, addYears, format, subMonths, subYears } from "date-fns";
import { ChevronLeft, ChevronRight, Filter as FilterIcon, Plus } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, ErrorText, Segmented } from "../components/ui";
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

  const range = view === "Monthly" ? yearRange(anchor.getFullYear()) : monthRange(anchor);
  const periodLabel = view === "Monthly" ? String(anchor.getFullYear()) : format(anchor, "MMMM yyyy");

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

  function goPrev() {
    setAnchor((d) => (view === "Monthly" ? subYears(d, 1) : subMonths(d, 1)));
  }
  function goNext() {
    setAnchor((d) => (view === "Monthly" ? addYears(d, 1) : addMonths(d, 1)));
  }

  function refresh() {
    loadTransactions();
    loadPriorTransactions();
  }

  return (
    <div className="relative space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} options={SUB_VIEW_OPTIONS} />

        <div className="relative flex items-center gap-2">
          <Button variant="ghost" onClick={() => setShowFilter((v) => !v)}>
            <FilterIcon size={16} className="mr-1.5" />
            Filter{selectedAccountIds !== null ? ` (${selectedAccountIds.size})` : ""}
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

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous period"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="text-sm font-semibold">{periodLabel}</p>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next period"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <ChevronRight size={18} />
          </button>
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
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700"
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
