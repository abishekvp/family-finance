import { useMemo } from "react";
import type { Transaction } from "../api/types";
import { formatCurrency } from "../lib/format";
import { SelectField, type SelectOption } from "./SelectField";

const DAY_MS = 24 * 60 * 60 * 1000;
// A refund this close in time and for the same amount is very likely the one: a card verification
// charge reversed within minutes, an order cancelled the same week.
const SUGGEST_WITHIN_DAYS = 10;

/** What's still left to refund on `original`, not counting `selfId`'s own earlier link to it. */
export function refundableLeft(original: Transaction, self: Transaction | null) {
  const own = self && self.refundsId === original.id ? self.amount : 0;
  return Math.max(0, original.amount - (original.refundedAmount ?? (original.isRefunded ? original.amount : 0)) + own);
}

/**
 * Picks the entry this one gives back: for an income, the expense it refunds; for an expense, the
 * income it returns. Entries of the same amount close to `date` are listed first.
 */
export function RefundsPicker({
  type,
  candidates,
  self,
  selectedId,
  onSelect,
  amount,
  date,
}: {
  /** The type of the entry being edited (INCOME refunds an expense, EXPENSE returns an income). */
  type: "INCOME" | "EXPENSE";
  /** Entries of the opposite type. */
  candidates: Transaction[];
  /** The entry being edited, if it already exists. */
  self: Transaction | null;
  selectedId: string | null;
  onSelect: (id: string | null, left: number | null) => void;
  amount: number;
  date: Date | null;
}) {
  const options = useMemo<SelectOption[]>(() => {
    const at = date?.getTime() ?? Date.now();
    const rows = candidates
      .filter((t) => !t.isDeleted && !t.refundsId && t.id !== self?.id)
      .map((t) => ({ t, left: refundableLeft(t, self) }))
      .filter(({ t, left }) => left > 0.005 || t.id === selectedId);
    const suggested = (t: Transaction, left: number) =>
      amount > 0 && Math.abs(left - amount) < 0.005 && Math.abs(new Date(t.date).getTime() - at) <= SUGGEST_WITHIN_DAYS * DAY_MS;
    rows.sort((a, b) => {
      const sa = suggested(a.t, a.left) ? 0 : 1;
      const sb = suggested(b.t, b.left) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return new Date(b.t.date).getTime() - new Date(a.t.date).getTime();
    });
    return rows.slice(0, 300).map(({ t, left }) => {
      const currency = t.account.currency;
      const day = new Date(t.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
      const partial = left < t.amount - 0.005 ? ` · ${formatCurrency(left, currency)} left` : "";
      return {
        id: t.id,
        label: `${t.payee || t.category?.name || (t.type === "EXPENSE" ? "Expense" : "Income")} · ${formatCurrency(t.amount, currency)}`,
        detail: `${suggested(t, left) ? "Same amount · " : ""}${day} · ${t.account.name}${partial}`,
        color: t.category?.color,
        keywords: `${t.amount} ${t.category?.name ?? ""} ${t.notes ?? ""}`,
      };
    });
  }, [candidates, self, selectedId, amount, date]);

  const byId = useMemo(() => new Map(candidates.map((t) => [t.id, t])), [candidates]);

  return (
    <SelectField
      title={type === "INCOME" ? "Refund of which expense?" : "Return of which income?"}
      options={options}
      selectedId={selectedId}
      onSelect={(id) => {
        const original = id ? byId.get(id) : undefined;
        onSelect(id, original ? refundableLeft(original, self) : null);
      }}
      placeholder={type === "INCOME" ? "Not a refund" : "Not a return"}
      clearLabel={type === "INCOME" ? "Not a refund" : "Not a return"}
      searchPlaceholder="Search by payee, amount or category"
      emptyText="No matching entries."
    />
  );
}
