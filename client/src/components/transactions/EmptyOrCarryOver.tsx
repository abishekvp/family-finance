import { ArrowLeftRight } from "lucide-react";
import { EmptyState } from "../ui";
import { Money } from "../figures";

// Shown wherever a viewed period has zero transactions. When the user's carry-over
// preference is on, this renders the cumulative account balance as of the start of the
// period instead of a bare empty state (see Settings → carry-over balances).
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
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} icon={<ArrowLeftRight size={20} />} />
    );
  }

  return (
    <div className="flex items-center justify-between rounded-2xl border border-dashed border-line-strong bg-surface-sunken/50 px-4 py-4">
      <div>
        <p className="text-sm font-semibold text-ink">Carried over</p>
        <p className="text-xs text-ink-subtle">Cumulative balance heading into this period</p>
      </div>
      <p className="tnum text-sm font-bold">
        <Money amount={amount} currency={currency} tone="auto" />
      </p>
    </div>
  );
}
