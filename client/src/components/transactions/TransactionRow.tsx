import { ArrowRightLeft } from "lucide-react";
import type { Transaction } from "../../api/types";
import { formatCurrency } from "../../lib/format";

export function TransactionRow({
  transaction,
  onClick,
}: {
  transaction: Transaction;
  onClick?: () => void;
}) {
  const description =
    transaction.payee ||
    transaction.category?.name ||
    (transaction.type === "TRANSFER" ? "Transfer" : "Transaction");

  const amountClass =
    transaction.type === "INCOME"
      ? "text-income"
      : transaction.type === "EXPENSE"
        ? "text-expense"
        : "text-slate-700 dark:text-slate-200";

  const sign = transaction.type === "INCOME" ? "+" : transaction.type === "EXPENSE" ? "-" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: transaction.category?.color ?? "#94A3B8" }}
        >
          {transaction.type === "TRANSFER" ? (
            <ArrowRightLeft size={14} />
          ) : (
            description.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{description}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {transaction.account.name}
            {transaction.type === "TRANSFER" && transaction.transferToAccount
              ? ` → ${transaction.transferToAccount.name}`
              : ""}
            {transaction.category && transaction.type !== "TRANSFER" ? ` · ${transaction.category.name}` : ""}
          </p>
        </div>
      </div>
      <p className={`shrink-0 text-sm font-semibold ${amountClass}`}>
        {sign}
        {formatCurrency(transaction.amount, transaction.account.currency)}
      </p>
    </button>
  );
}
