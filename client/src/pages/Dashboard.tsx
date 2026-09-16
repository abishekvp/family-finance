import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, ErrorText, Input, Label } from "../components/ui";
import type { LayoutContext } from "../components/Layout";

const ACCOUNT_TYPES = ["CASH", "BANK", "SAVINGS", "CREDIT_CARD", "DEBIT_CARD", "INVESTMENT", "LOAN"] as const;

interface Account {
  id: string;
  name: string;
  type: (typeof ACCOUNT_TYPES)[number];
  currency: string;
  balance: number;
  owner: { id: string; name: string } | null;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export function Dashboard() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);

  async function loadAccounts() {
    setIsLoading(true);
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
    loadAccounts().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  const visibleAccounts =
    scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id);
  const totalBalance = visibleAccounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">{scope === "family" ? "Family" : "Your"} total balance</p>
          <p className="mt-2 text-2xl font-semibold">{formatCurrency(totalBalance, family.currency)}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Accounts</p>
          <p className="mt-2 text-2xl font-semibold">{visibleAccounts.length}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Your role</p>
          <p className="mt-2 text-2xl font-semibold capitalize">{family.role.toLowerCase()}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Accounts</h2>
          <Button variant="secondary" onClick={() => setShowAddAccount((v) => !v)}>
            {showAddAccount ? "Cancel" : "Add account"}
          </Button>
        </div>

        {showAddAccount && (
          <AddAccountForm
            familyId={family.id}
            onCreated={() => {
              setShowAddAccount(false);
              loadAccounts();
            }}
          />
        )}

        <ErrorText>{error}</ErrorText>

        {isLoading ? (
          <p className="text-sm text-slate-400">Loading accounts...</p>
        ) : visibleAccounts.length === 0 ? (
          <p className="text-sm text-slate-400">
            No accounts yet. Add a common family account or a private account of your own to get started.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {visibleAccounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">{account.name}</p>
                  <p className="text-xs text-slate-500">
                    {account.type.replace("_", " ")} ·{" "}
                    {account.owner ? account.owner.name : "Shared (Common)"}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold ${account.balance < 0 ? "text-expense" : "text-slate-900 dark:text-slate-100"}`}
                >
                  {formatCurrency(account.balance, account.currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddAccountForm({ familyId, onCreated }: { familyId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof ACCOUNT_TYPES)[number]>("BANK");
  const [isCommon, setIsCommon] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/accounts`, {
        name,
        type,
        isCommon,
        openingBalance: Number(openingBalance) || 0,
      });
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create account"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50 sm:grid-cols-2">
      <div>
        <Label htmlFor="account-name">Name</Label>
        <Input id="account-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="account-type">Type</Label>
        <select
          id="account-type"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="opening-balance">Opening balance</Label>
        <Input
          id="opening-balance"
          type="number"
          step="0.01"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
        />
      </div>
      <div className="flex items-end gap-2">
        <input
          id="is-common"
          type="checkbox"
          checked={isCommon}
          onChange={(e) => setIsCommon(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <Label htmlFor="is-common" className="mb-0">
          Shared family (common) account
        </Label>
      </div>
      <div className="sm:col-span-2">
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Adding..." : "Add account"}
        </Button>
      </div>
    </form>
  );
}
