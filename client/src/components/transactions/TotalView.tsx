import { useEffect, useState } from "react";
import { Download, Landmark } from "lucide-react";
import type { Account, Budget, Transaction } from "../../api/types";
import { Money } from "../figures";
import { cumulativeBalance } from "../../lib/carryOver";
import { Button, Card, Dot, ErrorText, ProgressBar, SkeletonRows } from "../ui";
import { EmptyOrCarryOver } from "./EmptyOrCarryOver";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";

export function TotalView({
  familyId,
  periodLabel,
  periodYear,
  periodMonth,
  transactions,
  historyForCarryOver,
  accounts,
  accountIds,
  periodStart,
  currency,
  carryOverEnabled,
  isLoading,
}: {
  familyId: string;
  periodLabel: string;
  periodYear: number;
  periodMonth: number;
  transactions: Transaction[];
  historyForCarryOver: Transaction[];
  accounts: Account[];
  accountIds: Set<string>;
  periodStart: Date;
  currency: string;
  carryOverEnabled: boolean;
  isLoading: boolean;
}) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetsError, setBudgetsError] = useState<string | null>(null);
  const [isLoadingBudgets, setIsLoadingBudgets] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingBudgets(true);
    setBudgetsError(null);
    api
      .get<Budget[]>(`/families/${familyId}/budgets`, { params: { year: periodYear, month: periodMonth } })
      .then((res) => {
        if (!cancelled) setBudgets(res.data);
      })
      .catch((err) => {
        if (!cancelled) setBudgetsError(getErrorMessage(err, "Unable to load budgets"));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBudgets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, periodYear, periodMonth, transactions]);

  const income = transactions.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);

  const accountTotals = accounts
    .filter((a) => accountIds.has(a.id))
    .map((account) => {
      const accTx = transactions.filter((t) => t.accountId === account.id);
      return {
        account,
        income: accTx.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0),
        expense: accTx.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0),
      };
    });

  function handleExport() {
    const header = ["Date", "Type", "Account", "Category", "Payee", "Notes", "Amount"];
    const rows = transactions.map((t) => [
      t.date.slice(0, 10),
      t.type,
      t.account.name,
      t.category?.name ?? "",
      t.payee ?? "",
      t.notes ?? "",
      String(t.amount),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `transactions-${periodLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return <SkeletonRows rows={4} />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface-sunken/50 py-5 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{periodLabel}</p>
        <p className="tnum text-3xl font-extrabold tracking-tight text-ink">
          <Money amount={income - expense} currency={currency} signed />
        </p>
        <div className="mt-4 flex items-center justify-center gap-6 text-sm">
          <span className="tnum font-semibold text-income">
            +<Money amount={income} currency={currency} />
          </span>
          <span className="tnum font-semibold text-expense">
            −<Money amount={expense} currency={currency} />
          </span>
        </div>
      </div>

      {transactions.length === 0 && (
        <EmptyOrCarryOver
          carryOverEnabled={carryOverEnabled}
          amount={carryOverEnabled ? cumulativeBalance(accounts, historyForCarryOver, accountIds, periodStart) : 0}
          currency={currency}
          emptyTitle="No transactions in this period"
        />
      )}

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-ink">Budgets</h3>
        <ErrorText>{budgetsError}</ErrorText>
        {isLoadingBudgets ? (
          <SkeletonRows rows={2} />
        ) : budgets.length === 0 ? (
          <p className="text-sm text-ink-subtle">No budgets set for this month yet. Set one up in Settings.</p>
        ) : (
          <ul className="space-y-3.5">
            {budgets.map((b) => {
              const pct = b.amount > 0 ? b.spent / b.amount : 0;
              const over = b.spent > b.amount;
              return (
                <li key={b.id}>
                  <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      <Dot color={b.category.color} size={8} />
                      {b.category.name}
                    </span>
                    <span className={over ? "tnum text-expense" : "tnum text-ink-subtle"}>
                      <Money amount={b.spent} currency={currency} /> / <Money amount={b.amount} currency={currency} />
                    </span>
                  </div>
                  <ProgressBar value={pct} tone={over ? "expense" : "brand"} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Accounts</h3>
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={handleExport} disabled={transactions.length === 0}>
            Export
          </Button>
        </div>
        {accountTotals.length === 0 ? (
          <p className="text-sm text-ink-subtle">No accounts selected.</p>
        ) : (
          <ul className="divide-y divide-line">
            {accountTotals.map(({ account, income: accIncome, expense: accExpense }) => (
              <li key={account.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-600">
                  <Landmark size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{account.name}</span>
                <span className="tnum flex shrink-0 gap-3 text-xs">
                  <span className="text-income">
                    +<Money amount={accIncome} currency={account.currency} />
                  </span>
                  <span className="text-expense">
                    −<Money amount={accExpense} currency={account.currency} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
