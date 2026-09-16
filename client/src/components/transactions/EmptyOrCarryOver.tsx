import { EmptyState } from "../ui";
import { formatCurrency } from "../../lib/format";

// Shown wherever a viewed period has zero transactions. When the user's carry-over
// preference is on, this renders the cumulative account balance as of the start of the
// period instead of a bare empty state (see product-scope item 6 / Settings).
export function EmptyOrCarryOver({
  carryOverEnabled,
  amount,
  currency,
  emptyTitle,
  emptyDescription,
}: {
  carryOverEnabled: boolean;
  amount: number;
  currency: string;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  if (!carryOverEnabled) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 px-4 py-4 dark:border-slate-700">
      <div>
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Carry-over</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">Cumulative balance carried into this period</p>
      </div>
      <p className={`text-sm font-semibold ${amount < 0 ? "text-expense" : "text-slate-900 dark:text-slate-100"}`}>
        {formatCurrency(amount, currency)}
      </p>
    </div>
  );
}
