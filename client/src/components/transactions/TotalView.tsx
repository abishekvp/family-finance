import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Account, Budget, Transaction } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { cumulativeBalance } from "../../lib/carryOver";
import { Button, Card, ErrorText, Spinner } from "../ui";
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
    return <Spinner label="Loading summary..." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{periodLabel}</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-slate-500">Income</p>
            <p className="mt-1 text-lg font-semibold text-income">{formatCurrency(income, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Expense</p>
            <p className="mt-1 text-lg font-semibold text-expense">{formatCurrency(expense, currency)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Total</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(income - expense, currency)}</p>
          </div>
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
        <h3 className="mb-3 text-sm font-semibold">Budgets</h3>
        <ErrorText>{budgetsError}</ErrorText>
        {isLoadingBudgets ? (
          <Spinner label="Loading budgets..." />
        ) : budgets.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No budgets set for this month yet. Set one up in Settings.
          </p>
        ) : (
          <ul className="space-y-3">
            {budgets.map((b) => {
              const pct = b.amount > 0 ? Math.min(1, b.spent / b.amount) : 0;
              const over = b.spent > b.amount;
              return (
                <li key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.category.color }} />
                      {b.category.name}
                    </span>
                    <span className={over ? "text-expense" : "text-slate-500"}>
                      {formatCurrency(b.spent, currency)} / {formatCurrency(b.amount, currency)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${over ? "bg-expense" : "bg-brand-500"}`}
                      style={{ width: `${pct * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Accounts</h3>
          <Button variant="secondary" onClick={handleExport} disabled={transactions.length === 0}>
            <Download size={14} className="mr-1.5" />
            Export
          </Button>
        </div>
        {accountTotals.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No accounts selected.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {accountTotals.map(({ account, income: accIncome, expense: accExpense }) => (
              <li key={account.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium">{account.name}</span>
                <span className="flex gap-3 text-xs">
                  <span className="text-income">+{formatCurrency(accIncome, account.currency)}</span>
                  <span className="text-expense">-{formatCurrency(accExpense, account.currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
