import { ArrowRightLeft } from "lucide-react";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";
import { Dot, cn } from "../ui";
import { isFamilyTransfer } from "../../lib/transactionTotals";

function Tag({ children }: { children: string }) {
  return <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-subtle">{children}</span>;
}

/**
 * One transaction. `detailed` lays it out as table columns on a wide screen — description, category,
 * account, time, amount — and folds back to the two-line row on a phone.
 */
export function TransactionRow({
  transaction,
  onClick,
  detailed = false,
}: {
  transaction: Transaction;
  onClick?: () => void;
  detailed?: boolean;
}) {
  const t = transaction;
  const familyTransfer = isFamilyTransfer(t);
  const description = t.payee || t.category?.name || (t.type === "TRANSFER" ? "Transfer" : familyTransfer ? "Family transfer" : "Uncategorized");

  const isTransfer = t.type === "TRANSFER";
  const isExpense = t.type === "EXPENSE";
  // Family money isn't income or spending, so it reads neutral like a transfer.
  const tone = familyTransfer ? undefined : t.type === "INCOME" ? "income" : isExpense ? "expense" : undefined;
  const displayAmount = isExpense ? -t.amount : t.amount;
  const accountText = isTransfer && t.transferToAccount ? `${t.account.name} → ${t.transferToAccount.name}` : t.account.name;

  const tags = (
    <>
      {t.isRefunded && !t.refundsId && <Tag>{(t.refundedAmount ?? t.amount) >= t.amount - 0.005 ? "Refunded" : "Part refunded"}</Tag>}
      {familyTransfer && <Tag>{t.type === "INCOME" ? "From family" : "To family"}</Tag>}
      {t.recurringId && <Tag>Repeating</Tag>}
      {t.refundsId && <Tag>{t.type === "INCOME" ? "Refund" : "Returned"}</Tag>}
    </>
  );

  const category = isTransfer ? (
    <span className="text-ink-muted">Transfer</span>
  ) : t.category ? (
    <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
      <Dot color={t.category.color} size={8} />
      <span className="truncate">{t.category.name}</span>
    </span>
  ) : familyTransfer ? (
    <span className="text-ink-muted">Family transfer</span>
  ) : (
    <span className="text-warn">Uncategorized</span>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mx-2 flex w-full items-center justify-between gap-3 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-sunken",
        detailed && "lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_4.5rem_8.5rem] lg:gap-4 lg:py-2.5"
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: isTransfer ? undefined : t.category?.color ?? "#94A3B8" }}
        >
          {isTransfer ? <ArrowRightLeft size={15} className="text-ink-muted" /> : description.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            <span className="truncate">{description}</span>
            {tags}
          </p>
          <p className={cn("truncate text-xs text-ink-subtle", detailed && "lg:hidden")}>
            {isTransfer ? accountText : t.category ? `${t.account.name} · ${t.category.name}` : t.account.name}
          </p>
          {detailed && t.notes && <p className="hidden truncate text-xs text-ink-subtle lg:block">{t.notes}</p>}
        </div>
      </div>
      {detailed && (
        <>
          <span className="hidden min-w-0 text-sm lg:block">{category}</span>
          <span className="hidden truncate text-sm text-ink-muted lg:block">{accountText}</span>
          <span className="tnum hidden text-xs text-ink-subtle lg:block">
            {new Date(t.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        </>
      )}
      <p className="tnum shrink-0 text-sm font-bold lg:text-right">
        <Money amount={displayAmount} currency={t.account.currency} tone={tone} signed={!isTransfer} />
      </p>
    </button>
  );
}
