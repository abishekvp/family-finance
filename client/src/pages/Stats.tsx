import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { addMonths, addYears, format, subMonths, subYears } from "date-fns";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, PieChart as PieChartIcon } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, Dot, EmptyState, ErrorText, ProgressBar, Segmented, SkeletonRows } from "../components/ui";
import { Money } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import type { Account, Transaction } from "../api/types";
import { monthRange, yearRange } from "../lib/dateUtils";
import { formatPercent } from "../lib/format";
import { CategoryPie, type CategorySlice } from "../components/stats/CategoryPie";

type Metric = "Income" | "Expenses";
type Period = "Monthly" | "Yearly";

const UNCATEGORIZED_COLOR = "#94A3B8";

function totalFor(transactions: Transaction[], accountIds: Set<string>) {
  return transactions.filter((t) => accountIds.has(t.accountId)).reduce((s, t) => s + t.amount, 0);
}

export function Stats() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const [metric, setMetric] = useState<Metric>("Expenses");
  const [period, setPeriod] = useState<Period>("Monthly");
  const [anchor, setAnchor] = useState(() => new Date());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [previousTransactions, setPreviousTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = period === "Yearly" ? yearRange(anchor.getFullYear()) : monthRange(anchor);
  const previousAnchor = period === "Yearly" ? subYears(anchor, 1) : subMonths(anchor, 1);
  const previousRange = period === "Yearly" ? yearRange(previousAnchor.getFullYear()) : monthRange(previousAnchor);
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
    Promise.all([
      api.get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { type, from: range.from.toISOString(), to: range.to.toISOString(), limit: 1000 },
      }),
      api
        .get<Transaction[]>(`/families/${family.id}/transactions`, {
          params: { type, from: previousRange.from.toISOString(), to: previousRange.to.toISOString(), limit: 1000 },
        })
        .catch(() => ({ data: [] as Transaction[] })),
    ])
      .then(([current, previous]) => {
        if (cancelled) return;
        setTransactions(current.data);
        setPreviousTransactions(previous.data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const previousTotal = useMemo(
    () => totalFor(previousTransactions, scopedAccountIds),
    [previousTransactions, scopedAccountIds]
  );

  const delta = total - previousTotal;
  const deltaGood = metric === "Income" ? delta >= 0 : delta <= 0;
  const previousLabel = period === "Yearly" ? "last year" : "last month";

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
        <div className="mb-5 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="!px-2" onClick={goPrev} aria-label="Previous period">
            <ChevronLeft size={18} />
          </Button>
          <p className="text-sm font-semibold text-ink">{periodLabel}</p>
          <Button variant="ghost" size="sm" className="!px-2" onClick={goNext} aria-label="Next period">
            <ChevronRight size={18} />
          </Button>
        </div>

        <ErrorText>{error}</ErrorText>

        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : total === 0 ? (
          <EmptyState
            title={`No ${metric.toLowerCase()} recorded`}
            description="Add a transaction to see it broken down by category here."
            icon={<PieChartIcon size={20} />}
          />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-around">
              <CategoryPie slices={slices} currency={family.currency} metricLabel={`Total ${metric.toLowerCase()}`} />
              {(delta !== 0 || previousTotal !== 0) && (
                <div className="text-center sm:text-left">
                  <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">vs {previousLabel}</p>
                  <p
                    className={`mt-1 flex items-center justify-center gap-1 text-sm font-bold sm:justify-start ${
                      deltaGood ? "text-income" : "text-expense"
                    }`}
                  >
                    {delta >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                    {formatPercent(previousTotal === 0 ? 1 : Math.abs(delta) / previousTotal)}
                  </p>
                  <p className="tnum mt-0.5 text-xs text-ink-subtle">
                    <Money amount={previousTotal} currency={family.currency} compact /> {previousLabel}
                  </p>
                </div>
              )}
            </div>

            <ul className="divide-y divide-line">
              {slices.map((slice, index) => (
                <li key={slice.key} className="flex items-center gap-3 py-3">
                  <span className="w-5 shrink-0 text-center text-xs font-bold text-ink-subtle">{index + 1}</span>
                  <Dot color={slice.color} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{slice.name}</span>
                      <span className="tnum shrink-0 text-sm font-bold">
                        <Money amount={slice.amount} currency={family.currency} />
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={slice.fraction} className="flex-1" />
                      <span className="w-10 shrink-0 text-right text-2xs font-semibold text-ink-subtle">
                        {formatPercent(slice.fraction)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
