import { useMemo, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Banknote,
  CreditCard,
  HandCoins,
  Landmark,
  LineChart,
  PiggyBank,
  Plus,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  Label,
  Modal,
  ProgressBar,
  SkeletonRows,
  Toggle,
} from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import { ACCOUNT_TYPES } from "../api/types";
import type { Account, AccountType } from "../api/types";
import { humanizeEnum, safePercent } from "../lib/format";
import { useFamilyData } from "../context/FamilyDataContext";

const GROUPS: { title: string; types: AccountType[] }[] = [
  { title: "Cash", types: ["CASH"] },
  { title: "Accounts", types: ["BANK", "SAVINGS", "INVESTMENT"] },
  { title: "Card", types: ["CREDIT_CARD", "DEBIT_CARD"] },
  { title: "Loans", types: ["LOAN"] },
  { title: "Lend & borrow", types: ["PERSON"] },
];

const TYPE_ICONS: Record<AccountType, LucideIcon> = {
  CASH: Wallet,
  BANK: Landmark,
  SAVINGS: PiggyBank,
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
  INVESTMENT: LineChart,
  LOAN: Banknote,
  PERSON: HandCoins,
};

/** What a person's tab means: a positive balance is money they owe you, a negative one money you owe them. */
function personStatus(balance: number) {
  if (balance > 0) return "Owes you";
  if (balance < 0) return "You owe";
  return "Settled up";
}

export function Accounts() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  // Shared with Dashboard and Transactions (see FamilyDataContext) so switching to this tab doesn't
  // re-fetch accounts that were just loaded there.
  const { accounts, isLoadingStatic: isLoading, staticError: error, refreshAccounts } = useFamilyData();
  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const scopedAccounts = useMemo(
    () => (scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id)),
    [accounts, scope, user]
  );

  // total/liabilities/assets formula from the shared contract — kept identical to the
  // server and mobile implementations so every surface reports the same numbers.
  const totals = useMemo(() => {
    const total = scopedAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
    const liabilities = scopedAccounts.reduce((s, a) => {
      // Money you owe a friend is a debt like any other.
      if (a.type === "CREDIT_CARD" || a.type === "LOAN" || a.type === "PERSON") {
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
      await refreshAccounts();
    } catch (err) {
      setArchiveError(getErrorMessage(err, "Unable to archive account"));
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Assets" value={totals.assets} currency={family.currency} accent="income" tone="income" loading={isLoading} />
        <StatTile label="Liabilities" value={totals.liabilities} currency={family.currency} accent="expense" tone="expense" loading={isLoading} />
        <StatTile label="Total" value={totals.total} currency={family.currency} accent="brand" tone="auto" loading={isLoading}>
          {!isLoading && totals.assets > 0 && (
            <ProgressBar value={safePercent(totals.liabilities, totals.assets) / 100} tone="expense" />
          )}
        </StatTile>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">Your accounts</h2>
        <Button icon={<Plus size={16} />} onClick={() => setEditingAccount("new")}>
          Add account
        </Button>
      </div>

      <ErrorText>{error || archiveError}</ErrorText>

      {isLoading ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : scopedAccounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="Add your first account to start tracking balances."
          icon={<Wallet size={20} />}
          action={
            <Button size="sm" icon={<Plus size={15} />} onClick={() => setEditingAccount("new")}>
              Add account
            </Button>
          }
        />
      ) : (
        <div className="space-y-5">
          {GROUPS.map((group) => {
            const groupAccounts = scopedAccounts.filter((a) => group.types.includes(a.type));
            if (groupAccounts.length === 0) return null;
            const subtotal = groupAccounts.reduce((s, a) => s + (a.balance ?? 0), 0);
            return (
              <Card key={group.title}>
                <CardHeader
                  title={group.title}
                  actions={<Money amount={subtotal} currency={family.currency} className="text-sm font-bold" />}
                  className="mb-2"
                />
                <ul className="divide-y divide-line">
                  {groupAccounts.map((account) => {
                    const Icon = TYPE_ICONS[account.type];
                    const isConfirming = archivingId === account.id;
                    const balance = account.balance ?? 0;
                    const creditLimit = account.creditLimit != null ? Number(account.creditLimit) : null;
                    const utilisation = account.type === "CREDIT_CARD" && creditLimit ? Math.max(0, -balance) : null;
                    const isPerson = account.type === "PERSON";
                    return (
                      <li key={account.id} className="py-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setEditingAccount(account)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-600">
                              <Icon size={17} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">{account.name}</p>
                              <p className="flex items-center gap-1.5 truncate text-xs text-ink-subtle">
                                {isPerson ? personStatus(balance) : humanizeEnum(account.type)}
                                <Badge tone={account.owner ? "neutral" : "brand"} className="normal-case">
                                  {account.owner ? account.owner.name : "Shared"}
                                </Badge>
                              </p>
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-2">
                            <Money
                              amount={isPerson ? Math.abs(balance) : balance}
                              currency={account.currency}
                              tone={balance < 0 ? "expense" : isPerson && balance > 0 ? "income" : undefined}
                              className="text-sm font-bold"
                            />
                            {isConfirming ? (
                              <span className="flex items-center gap-1">
                                <Button size="sm" variant="danger" onClick={() => handleArchive(account.id)}>
                                  Confirm
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setArchivingId(null)}>
                                  Cancel
                                </Button>
                              </span>
                            ) : (
                              <IconButton
                                label={`Archive ${account.name}`}
                                tone="danger"
                                onClick={() => setArchivingId(account.id)}
                              >
                                <Trash2 size={15} />
                              </IconButton>
                            )}
                          </div>
                        </div>
                        {utilisation !== null && creditLimit && (
                          <div className="mt-2.5 pl-[52px]">
                            <ProgressBar
                              value={utilisation / creditLimit}
                              tone={utilisation / creditLimit > 0.8 ? "expense" : "warn"}
                            />
                            <p className="mt-1 text-2xs text-ink-subtle">
                              <Money amount={utilisation} currency={account.currency} compact /> of{" "}
                              <Money amount={creditLimit} currency={account.currency} compact /> used
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
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
          onSaved={refreshAccounts}
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
    <Modal
      title={isEdit ? "Edit account" : "Add account"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" loading={isSubmitting} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <form id="account-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          {(props) => <Input {...props} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Joint Checking" />}
        </Field>

        <div>
          <Label>Type</Label>
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_TYPES.map((t) => {
              const Icon = TYPE_ICONS[t];
              return (
                <Chip key={t} type="button" selected={type === t} onClick={() => setType(t)}>
                  <Icon size={12} />
                  {humanizeEnum(t)}
                </Chip>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Opening balance"
            hint={type === "PERSON" ? "Positive if they already owe you, negative if you owe them" : undefined}
          >
            {(props) => (
              <Input {...props} type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
            )}
          </Field>
          <Field label="Credit limit" hint="Optional">
            {(props) => (
              <Input {...props} type="number" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} placeholder="Optional" />
            )}
          </Field>
        </div>

        {!isEdit && (
          <>
            <Field label="Currency">
              {(props) => (
                <Input
                  {...props}
                  required
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="w-24 uppercase"
                />
              )}
            </Field>
            <Toggle
              checked={isCommon}
              onChange={setIsCommon}
              label="Shared family account"
              description="Visible to the whole family rather than just you."
            />
          </>
        )}

        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}
