import { ArrowRightLeft } from "lucide-react";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";

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

  const isTransfer = transaction.type === "TRANSFER";
  const isExpense = transaction.type === "EXPENSE";
  const tone = transaction.type === "INCOME" ? "income" : isExpense ? "expense" : undefined;
  const displayAmount = isExpense ? -transaction.amount : transaction.amount;

  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: isTransfer ? undefined : transaction.category?.color ?? "#94A3B8" }}
        >
          {isTransfer ? (
            <ArrowRightLeft size={15} className="text-ink-muted" />
          ) : (
            description.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{description}</p>
          <p className="truncate text-xs text-ink-subtle">
            {isTransfer && transaction.transferToAccount
              ? `${transaction.account.name} → ${transaction.transferToAccount.name}`
              : transaction.category
                ? `${transaction.account.name} · ${transaction.category.name}`
                : transaction.account.name}
          </p>
        </div>
      </div>
      <p className="tnum shrink-0 text-sm font-bold">
        <Money amount={displayAmount} currency={transaction.account.currency} tone={tone} signed={!isTransfer} />
      </p>
    </button>
  );
}
