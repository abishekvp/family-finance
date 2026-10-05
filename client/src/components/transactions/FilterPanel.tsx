import { Wallet } from "lucide-react";
import type { Account, Transaction } from "../../api/types";
import { Money } from "../figures";
import { Checkbox, Popover } from "../ui";
import { countedAmount } from "../../lib/transactionTotals";

export function FilterPanel({
  accounts,
  transactions,
  selectedAccountIds,
  onChange,
  currency,
  onClose,
}: {
  accounts: Account[];
  transactions: Transaction[];
  selectedAccountIds: Set<string> | null;
  onChange: (ids: Set<string> | null) => void;
  currency: string;
  onClose: () => void;
}) {
  const activeIds = selectedAccountIds ?? new Set(accounts.map((a) => a.id));

  function toggle(accountId: string) {
    const next = new Set(activeIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    // Selecting every account is equivalent to no filter at all — collapse back to null so
    // newly-added accounts stay visible without the user having to re-check them.
    onChange(next.size === accounts.length ? null : next);
  }

  function balanceFor(accountId: string) {
    return transactions
      .filter((t) => t.accountId === accountId)
      .reduce((sum, t) => sum + (t.type === "INCOME" ? countedAmount(t) : t.type === "EXPENSE" ? -countedAmount(t) : 0), 0);
  }

  return (
    <Popover onClose={onClose} className="w-80">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-ink">Accounts</p>
        <div className="flex gap-3 text-xs font-semibold text-brand-600">
          <button type="button" onClick={() => onChange(null)} className="hover:underline">
            Select all
          </button>
          <button type="button" onClick={() => onChange(new Set())} className="hover:underline">
            Clear
          </button>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="py-4 text-center text-xs text-ink-subtle">No accounts to filter by yet.</p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {accounts.map((account) => (
            <li key={account.id}>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-sunken">
                <Checkbox
                  checked={activeIds.has(account.id)}
                  onChange={() => toggle(account.id)}
                  label=""
                  className="flex-none"
                />
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-600">
                  <Wallet size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{account.name}</span>
                  <span className="block truncate text-xs text-ink-subtle">
                    {account.owner ? account.owner.name : "Shared"}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold tnum text-ink-muted">
                  <Money amount={balanceFor(account.id)} currency={currency} signed />
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}
