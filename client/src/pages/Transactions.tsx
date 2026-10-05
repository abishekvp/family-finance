import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { addMonths, addYears, format, subMonths, subYears } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight, Filter as FilterIcon, Plus, Search, X } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Button, Card, Chip, ErrorText, Segmented } from "../components/ui";
import { Money } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Transaction } from "../api/types";
import { loadPrefs } from "../lib/prefs";
import { monthRange, yearRange } from "../lib/dateUtils";
import { DailyView } from "../components/transactions/DailyView";
import { CalendarView } from "../components/transactions/CalendarView";
import { MonthlyView } from "../components/transactions/MonthlyView";
import { TotalView } from "../components/transactions/TotalView";
import { FilterPanel } from "../components/transactions/FilterPanel";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";
import { countedAmount, countsTowardTotals } from "../lib/transactionTotals";
import { useFamilyData, useYearTransactions } from "../context/FamilyDataContext";

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
  const [search, setSearch] = useState("");

  // Accounts, categories and this year's transactions are cached once (in FamilyDataContext, up in
  // Layout) and shared with Dashboard and Insights too — switching sub-view here, or tabbing away
  // and back, never re-fetches; only crossing into a year not seen yet does.
  const { accounts, categories, isLoadingStatic, staticError, invalidateYear } = useFamilyData();
  const year = anchor.getFullYear();
  const { data: yearTransactions, isLoading: isLoadingYear } = useYearTransactions(year);

  const [priorTransactions, setPriorTransactions] = useState<Transaction[]>([]);
  const [priorError, setPriorError] = useState<string | null>(null);

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

  // Carry-over needs everything before the period, which can span years the cache above doesn't
  // hold — kept as its own lighter fetch rather than pulled into the year cache.
  async function loadPriorTransactions() {
    if (!prefs.carryOver) {
      setPriorTransactions([]);
      return;
    }
    setPriorError(null);
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { to: range.from.toISOString(), limit: 5000 },
      });
      setPriorTransactions(res.data);
    } catch (err) {
      setPriorTransactions([]);
      setPriorError(err instanceof Error ? err.message : "Unable to load prior transactions");
    }
  }

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

  // Monthly needs the whole year; the other sub-views slice it down to the current month —
  // switching between them is just a client-side filter over the same cached year.
  const periodTransactions = useMemo(() => {
    if (view === "Monthly") return yearTransactions;
    return yearTransactions.filter((t) => {
      const d = new Date(t.date);
      return d >= range.from && d < range.to;
    });
  }, [yearTransactions, view, range.from, range.to]);

  const searchedTransactions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return periodTransactions;
    return periodTransactions.filter((t) =>
      [t.payee, t.notes, t.category?.name, t.account.name].some((field) => field?.toLowerCase().includes(q))
    );
  }, [periodTransactions, search]);

  const visibleTransactions = useMemo(
    () => searchedTransactions.filter((t) => accountIds.has(t.accountId)),
    [searchedTransactions, accountIds]
  );

  const historyForCarryOver = useMemo(
    () => [...priorTransactions, ...yearTransactions],
    [priorTransactions, yearTransactions]
  );

  const periodTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of visibleTransactions) {
      if (!countsTowardTotals(t)) continue;
      if (t.type === "INCOME") income += countedAmount(t);
      else if (t.type === "EXPENSE") expense += countedAmount(t);
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

  function refresh(saved?: Transaction) {
    invalidateYear(year);
    if (saved) invalidateYear(new Date(saved.date).getFullYear());
    loadPriorTransactions();
  }

  const isLoading = isLoadingStatic || isLoadingYear;
  const error = staticError || priorError;

  return (
    <div className="relative space-y-4 pb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} options={SUB_VIEW_OPTIONS} />

        <div className="relative flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="relative min-w-[160px] flex-1 sm:max-w-[240px] sm:flex-none">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search payee, notes, category…"
              className="w-full rounded-xl border border-line bg-surface py-1.5 pl-8 pr-7 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {selectedAccountIds !== null && (
            <Chip selected onClick={() => setSelectedAccountIds(null)}>
              {selectedAccountIds.size} account{selectedAccountIds.size === 1 ? "" : "s"} ✕
            </Chip>
          )}
          <Button variant="secondary" size="sm" icon={<Plus size={15} />} onClick={() => setShowAddForm(true)}>
            Add
          </Button>
          <div className="relative">
            <Button variant="ghost" size="sm" icon={<FilterIcon size={15} />} onClick={() => setShowFilter((v) => !v)}>
              Filter
            </Button>
            {showFilter && (
              <FilterPanel
                accounts={scopedAccounts}
                transactions={periodTransactions}
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
