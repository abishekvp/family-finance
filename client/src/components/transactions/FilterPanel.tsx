import { X } from "lucide-react";
import type { Account, Transaction } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { Button } from "../ui";

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
  onChange: (next: Set<string> | null) => void;
  currency: string;
  onClose: () => void;
}) {
  const isSelected = (id: string) => selectedAccountIds === null || selectedAccountIds.has(id);

  function toggle(id: string) {
    const current = selectedAccountIds ?? new Set(accounts.map((a) => a.id));
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    // Selecting every account is equivalent to no filter at all.
    onChange(next.size === accounts.length ? null : next);
  }

  function totalsFor(accountId: string) {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.accountId !== accountId) continue;
      if (t.type === "INCOME") income += t.amount;
      else if (t.type === "EXPENSE") expense += t.amount;
    }
    return { income, expense };
  }

  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[90vw] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Filter accounts</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close filter"
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X size={16} />
        </button>
      </div>

      <div className="mb-3 flex gap-2">
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => onChange(null)}>
          Select all
        </Button>
        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => onChange(new Set())}>
          Clear all
        </Button>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-slate-400">No accounts to filter yet.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {accounts.map((account) => {
            const { income, expense } = totalsFor(account.id);
            return (
              <li key={account.id}>
                <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected(account.id)}
                      onChange={() => toggle(account.id)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
                    />
                    <span className="truncate text-sm">{account.name}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <span className="block text-income">+{formatCurrency(income, account.currency || currency)}</span>
                    <span className="block text-expense">-{formatCurrency(expense, account.currency || currency)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
