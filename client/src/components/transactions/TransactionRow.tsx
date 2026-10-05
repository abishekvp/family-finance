import { ArrowRightLeft } from "lucide-react";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";
import { isFamilyTransfer } from "../../lib/transactionTotals";

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
    (transaction.type === "TRANSFER" ? "Transfer" : isFamilyTransfer(transaction) ? "Family transfer" : "Uncategorized");

  const isTransfer = transaction.type === "TRANSFER";
  const isExpense = transaction.type === "EXPENSE";
  // Family money isn't income or spending, so it reads neutral like a transfer.
  const tone = isFamilyTransfer(transaction) ? undefined : transaction.type === "INCOME" ? "income" : isExpense ? "expense" : undefined;
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
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            {description}
            {transaction.isRefunded && !transaction.refundsId && (
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-subtle">
                {(transaction.refundedAmount ?? transaction.amount) >= transaction.amount - 0.005 ? "Refunded" : "Part refunded"}
              </span>
            )}
            {isFamilyTransfer(transaction) && (
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-subtle">
                {transaction.type === "INCOME" ? "From family" : "To family"}
              </span>
            )}
            {transaction.recurringId && (
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-subtle">Repeating</span>
            )}
            {transaction.refundsId && (
              <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-subtle">
                {transaction.type === "INCOME" ? "Refund" : "Returned"}
              </span>
            )}
          </p>
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
