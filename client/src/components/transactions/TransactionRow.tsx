import { ArrowRightLeft, HandCoins } from "lucide-react";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";
import { Dot, cn } from "../ui";
import { formatTime } from "../../lib/dateUtils";
import { isFamilyTransfer, isNotCounted } from "../../lib/transactionTotals";
import { isWriteOff, lendingFlow } from "../../lib/lending";

const NO_PEOPLE: ReadonlySet<string> = new Set();

function Tag({ children }: { children: string }) {
  return <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold text-ink-subtle">{children}</span>;
}

/**
 * One transaction. `detailed` lays it out as table columns on a wide screen — description, category,
 * account, time, amount — and folds back to the two-line row on a phone. Lend & borrow entries carry
 * a sign (they move your account's balance) but no income/spending colour, since they're neither.
 */
export function TransactionRow({
  transaction,
  onClick,
  detailed = false,
  people = NO_PEOPLE,
  showDate = false,
}: {
  transaction: Transaction;
  onClick?: () => void;
  detailed?: boolean;
  /** Ids of the family's lend & borrow people, so entries with them read as lending. */
  people?: ReadonlySet<string>;
  /** In a list not already grouped by day. */
  showDate?: boolean;
}) {
  const t = transaction;
  const familyTransfer = isFamilyTransfer(t);
  const writtenOff = isWriteOff(t);
  const uncounted = familyTransfer || isNotCounted(t);
  const flow = lendingFlow(t, people);
  const isLending = flow !== null;
  const description = t.payee || t.category?.name || (t.type === "TRANSFER" ? "Transfer" : familyTransfer ? "Family transfer" : "Uncategorized");

  const isTransfer = t.type === "TRANSFER";
  const isExpense = t.type === "EXPENSE";
  // Family money, lending and uncounted entries aren't income or spending, so they read neutral.
  const tone = uncounted || isLending ? "muted" : t.type === "INCOME" ? "income" : isExpense ? "expense" : undefined;
  const displayAmount = isLending ? flow : isExpense ? -t.amount : t.amount;
  const accountText = isTransfer && t.transferToAccount ? `${t.account.name} → ${t.transferToAccount.name}` : t.account.name;
  const when = showDate
    ? `${new Date(t.date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${formatTime(t.date)}`
    : formatTime(t.date);

  const tags = (
    <>
      {t.isRefunded && !t.refundsId && <Tag>{(t.refundedAmount ?? t.amount) >= t.amount - 0.005 ? "Refunded" : "Part refunded"}</Tag>}
      {familyTransfer && <Tag>{t.type === "INCOME" ? "From family" : "To family"}</Tag>}
      {isLending && <Tag>Lend &amp; borrow</Tag>}
      {/* A loan written off as not coming back: the write-off is its own entry, marked here too. */}
      {isTransfer && (t.writtenOffAmount ?? 0) > 0.005 && <Tag>{t.writtenOffAmount! >= t.amount - 0.005 ? "Written off" : "Part written off"}</Tag>}
      {writtenOff ? <Tag>Written off</Tag> : !familyTransfer && uncounted ? <Tag>Not counted</Tag> : null}
      {t.sharedView && <Tag>Shared</Tag>}
      {t.recurringId && <Tag>Repeating</Tag>}
      {t.refundsId && <Tag>{t.type === "INCOME" ? "Refund" : "Returned"}</Tag>}
    </>
  );

  const category = isTransfer ? (
    <span className="text-ink-muted">{isLending ? "Lend & borrow" : "Transfer"}</span>
  ) : t.category ? (
    <span className="flex min-w-0 items-center gap-1.5 text-ink-muted">
      <Dot color={t.category.color} size={8} />
      <span className="truncate">{t.category.name}</span>
    </span>
  ) : familyTransfer ? (
    <span className="text-ink-muted">Family transfer</span>
  ) : writtenOff || uncounted ? (
    <span className="text-ink-muted">{writtenOff ? "Written off" : "Not counted"}</span>
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
          className={cn(
            "grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white",
            (isLending || writtenOff) && "bg-brand-soft text-brand-600"
          )}
          style={{ backgroundColor: isTransfer || writtenOff ? undefined : t.category?.color ?? "#94A3B8" }}
        >
          {isLending || writtenOff ? (
            <HandCoins size={15} />
          ) : isTransfer ? (
            <ArrowRightLeft size={15} className="text-ink-muted" />
          ) : (
            description.slice(0, 1).toUpperCase()
          )}
        </span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
            <span className="truncate">{description}</span>
            {tags}
          </p>
          <p className={cn("truncate text-xs text-ink-subtle", detailed && "lg:hidden")}>
            {when} · {isTransfer ? accountText : t.category ? `${t.account.name} · ${t.category.name}` : t.account.name}
          </p>
          {detailed && t.notes && <p className="hidden truncate text-xs text-ink-subtle lg:block">{t.notes}</p>}
        </div>
      </div>
      {detailed && (
        <>
          <span className="hidden min-w-0 text-sm lg:block">{category}</span>
          <span className="hidden truncate text-sm text-ink-muted lg:block">{accountText}</span>
          <span className="tnum hidden text-xs text-ink-subtle lg:block">{formatTime(t.date)}</span>
        </>
      )}
      <p className="tnum shrink-0 text-sm font-bold lg:text-right">
        <Money amount={displayAmount} currency={t.account.currency} tone={tone} signed={!isTransfer || isLending} />
      </p>
    </button>
  );
}
