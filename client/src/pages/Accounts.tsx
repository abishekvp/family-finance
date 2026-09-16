import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { Pencil, Plus } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, EmptyState, ErrorText, Input, Label, Modal, Select, Spinner } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import { ACCOUNT_TYPES } from "../api/types";
import type { Account, AccountType } from "../api/types";
import { formatCurrency } from "../lib/format";

const GROUPS: { title: string; types: AccountType[] }[] = [
  { title: "Cash", types: ["CASH"] },
  { title: "Accounts", types: ["BANK", "SAVINGS", "INVESTMENT"] },
  { title: "Card", types: ["CREDIT_CARD", "DEBIT_CARD"] },
  { title: "Loans", types: ["LOAN"] },
];

export function Accounts() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<Account[]>(`/families/${family.id}/accounts`);
      setAccounts(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load accounts"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  const scopedAccounts = useMemo(
    () => (scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id)),
    [accounts, scope, user]
  );

  // total/liabilities/assets formula from the shared contract — kept identical to the
  // server and mobile implementations so every surface reports the same numbers.
  const totals = useMemo(() => {
    const total = scopedAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
    const liabilities = scopedAccounts.reduce((s, a) => {
      if (a.type === "CREDIT_CARD" || a.type === "LOAN") {
        return s + Math.max(0, -(a.balance ?? 0));
      }
      return s;
    }, 0);
    return { total, liabilities, assets: total + liabilities };
  }, [scopedAccounts]);

  async function handleArchive(accountId: string) {
    setArchiveError(null);
    try {
      await api.delete(`/families/${family.id}/accounts/${accountId}`);
      setArchivingId(null);
      await load();
    } catch (err) {
      setArchiveError(getErrorMessage(err, "Unable to archive account"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Assets</p>
          <p className="mt-2 text-2xl font-semibold text-income">{formatCurrency(totals.assets, family.currency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Liabilities</p>
          <p className="mt-2 text-2xl font-semibold text-expense">
            {formatCurrency(totals.liabilities, family.currency)}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Total</p>
          <p className="mt-2 text-2xl font-semibold">{formatCurrency(totals.total, family.currency)}</p>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setEditingAccount("new")}>
          <Plus size={16} className="mr-1.5" />
          Add account
        </Button>
      </div>

      <ErrorText>{error || archiveError}</ErrorText>

      {isLoading ? (
        <Spinner label="Loading accounts..." />
      ) : scopedAccounts.length === 0 ? (
        <EmptyState title="No accounts yet" description="Add your first account to start tracking balances." />
      ) : (
        <div className="space-y-6">
          {GROUPS.map((group) => {
            const groupAccounts = scopedAccounts.filter((a) => group.types.includes(a.type));
            if (groupAccounts.length === 0) return null;
            const subtotal = groupAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
            return (
              <Card key={group.title}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-300">{group.title}</h2>
                  <p className="text-sm font-semibold">{formatCurrency(subtotal, family.currency)}</p>
                </div>
                <ul className="divide-y divide-slate-200 dark:divide-slate-800">
                  {groupAccounts.map((account) => (
                    <li key={account.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{account.name}</p>
                        <p className="text-xs text-slate-500">
                          {account.type.replace("_", " ")} · {account.owner ? account.owner.name : "Shared"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <p
                          className={`text-sm font-semibold ${
                            (account.balance ?? 0) < 0 ? "text-expense" : "text-slate-900 dark:text-slate-100"
                          }`}
                        >
                          {formatCurrency(account.balance ?? 0, account.currency)}
                        </p>
                        <button
                          type="button"
                          onClick={() => setEditingAccount(account)}
                          aria-label={`Edit ${account.name}`}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                          <Pencil size={14} />
                        </button>
                        {archivingId === account.id ? (
                          <span className="flex items-center gap-1.5 text-xs">
                            <button
                              type="button"
                              onClick={() => handleArchive(account.id)}
                              className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setArchivingId(null)}
                              className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setArchivingId(account.id)}
                            className="text-xs font-medium text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                          >
                            Archive
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {editingAccount && (
        <AccountFormModal
          familyId={family.id}
          account={editingAccount === "new" ? null : editingAccount}
          onClose={() => setEditingAccount(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}

function AccountFormModal({
  familyId,
  account,
  onClose,
  onSaved,
}: {
  familyId: string;
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(account);
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "BANK");
  const [isCommon, setIsCommon] = useState(account ? account.ownerId === null : false);
  const [currency, setCurrency] = useState(account?.currency ?? "USD");
  const [openingBalance, setOpeningBalance] = useState(String(account?.openingBalance ?? 0));
  const [creditLimit, setCreditLimit] = useState(account?.creditLimit != null ? String(account.creditLimit) : "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && account) {
        await api.patch(`/families/${familyId}/accounts/${account.id}`, {
          name,
          type,
          openingBalance: Number(openingBalance) || 0,
          ...(creditLimit ? { creditLimit: Number(creditLimit) } : {}),
        });
      } else {
        await api.post(`/families/${familyId}/accounts`, {
          name,
          type,
          isCommon,
          currency,
          openingBalance: Number(openingBalance) || 0,
          ...(creditLimit ? { creditLimit: Number(creditLimit) } : {}),
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save account"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit account" : "Add account"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="account-name">Name</Label>
          <Input id="account-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="account-type">Type</Label>
          <Select id="account-type" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="account-opening-balance">Opening balance</Label>
            <Input
              id="account-opening-balance"
              type="number"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="account-credit-limit">Credit limit</Label>
            <Input
              id="account-credit-limit"
              type="number"
              step="0.01"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        {!isEdit && (
          <>
            <div>
              <Label htmlFor="account-currency">Currency</Label>
              <Input
                id="account-currency"
                required
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                className="w-24 uppercase"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="account-is-common"
                type="checkbox"
                checked={isCommon}
                onChange={(e) => setIsCommon(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <Label htmlFor="account-is-common" className="mb-0">
                Shared family (common) account
              </Label>
            </div>
          </>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || !name.trim()}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
