import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addMonths, addYears, format, subMonths, subYears } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Card, EmptyState, ErrorText, Segmented, Spinner } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import type { Account, Transaction } from "../api/types";
import { monthRange, yearRange } from "../lib/dateUtils";
import { formatCurrency, formatPercent } from "../lib/format";
import { CategoryPie, type CategorySlice } from "../components/stats/CategoryPie";

type Metric = "Income" | "Expenses";
type Period = "Monthly" | "Yearly";

const UNCATEGORIZED_COLOR = "#94A3B8";

export function Stats() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const [metric, setMetric] = useState<Metric>("Expenses");
  const [period, setPeriod] = useState<Period>("Monthly");
  const [anchor, setAnchor] = useState(() => new Date());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = period === "Yearly" ? yearRange(anchor.getFullYear()) : monthRange(anchor);
  const periodLabel = period === "Yearly" ? String(anchor.getFullYear()) : format(anchor, "MMMM yyyy");
  const type = metric === "Income" ? "INCOME" : "EXPENSE";

  useEffect(() => {
    api
      .get<Account[]>(`/families/${family.id}/accounts`)
      .then((res) => setAccounts(res.data))
      .catch(() => undefined);
  }, [family.id]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api
      .get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { type, from: range.from.toISOString(), to: range.to.toISOString(), limit: 1000 },
      })
      .then((res) => {
        if (!cancelled) setTransactions(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err, "Unable to load stats"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [family.id, type, range.from.getTime(), range.to.getTime()]);

  const scopedAccountIds = useMemo(() => {
    const scoped = scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id);
    return new Set(scoped.map((a) => a.id));
  }, [accounts, scope, user]);

  const slices = useMemo<CategorySlice[]>(() => {
    const totals = new Map<string, { name: string; color: string; amount: number }>();
    for (const t of transactions) {
      if (!scopedAccountIds.has(t.accountId)) continue;
      const key = t.categoryId ?? "uncategorized";
      const entry = totals.get(key) ?? {
        name: t.category?.name ?? "Uncategorized",
        color: t.category?.color ?? UNCATEGORIZED_COLOR,
        amount: 0,
      };
      entry.amount += t.amount;
      totals.set(key, entry);
    }
    const total = Array.from(totals.values()).reduce((s, v) => s + v.amount, 0);
    return Array.from(totals.entries())
      .map(([key, v]) => ({
        key,
        name: v.name,
        color: v.color,
        amount: v.amount,
        fraction: total > 0 ? v.amount / total : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [transactions, scopedAccountIds]);

  const total = slices.reduce((s, v) => s + v.amount, 0);

  function goPrev() {
    setAnchor((d) => (period === "Yearly" ? subYears(d, 1) : subMonths(d, 1)));
  }
  function goNext() {
    setAnchor((d) => (period === "Yearly" ? addYears(d, 1) : addMonths(d, 1)));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={metric}
          onChange={setMetric}
          options={[
            { value: "Income", label: "Income" },
            { value: "Expenses", label: "Expenses" },
          ]}
        />
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: "Monthly", label: "Monthly" },
            { value: "Yearly", label: "Yearly" },
          ]}
        />
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

        {isLoading ? (
          <Spinner label="Loading stats..." />
        ) : total === 0 ? (
          <EmptyState
            title={`No ${metric.toLowerCase()} recorded`}
            description="Add a transaction to see it broken down by category here."
          />
        ) : (
          <div className="space-y-6">
            <CategoryPie slices={slices} currency={family.currency} />
            <ul className="divide-y divide-slate-200 dark:divide-slate-800">
              {slices.map((slice) => (
                <li key={slice.key} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                    <span className="truncate text-sm font-medium">{slice.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-sm">
                    <span className="text-slate-400 dark:text-slate-500">{formatPercent(slice.fraction)}</span>
                    <span className="font-semibold">{formatCurrency(slice.amount, family.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
