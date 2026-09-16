import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, ErrorText, Input, Label, Modal, Segmented, Select } from "../ui";
import type { Account, Category, Transaction, TransactionType } from "../../api/types";

const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "TRANSFER", label: "Transfer" },
];

function toDateInputValue(iso: string | undefined) {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().slice(0, 10);
}

interface FormState {
  type: TransactionType;
  accountId: string;
  transferToAccountId: string;
  categoryId: string;
  amount: string;
  date: string;
  payee: string;
  notes: string;
}

function emptyForm(accounts: Account[]): FormState {
  return {
    type: "EXPENSE",
    accountId: accounts[0]?.id ?? "",
    transferToAccountId: "",
    categoryId: "",
    amount: "",
    date: toDateInputValue(undefined),
    payee: "",
    notes: "",
  };
}

function formFromTransaction(t: Transaction): FormState {
  return {
    type: t.type,
    accountId: t.accountId,
    transferToAccountId: t.transferToAccountId ?? "",
    categoryId: t.categoryId ?? "",
    amount: String(t.amount),
    date: toDateInputValue(t.date),
    payee: t.payee ?? "",
    notes: t.notes ?? "",
  };
}

// Add/Edit form for a single transaction (product-scope item 5). Reused by the
// Transactions hub (floating add button + row tap) and Dashboard's quick-add button.
export function TransactionFormModal({
  familyId,
  accounts,
  categories,
  transaction,
  onClose,
  onSaved,
}: {
  familyId: string;
  accounts: Account[];
  categories: Category[];
  transaction?: Transaction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(transaction);
  const [form, setForm] = useState<FormState>(() =>
    transaction ? formFromTransaction(transaction) : emptyForm(accounts)
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!form.accountId && accounts.length > 0) {
      setForm((f) => ({ ...f, accountId: accounts[0].id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const categoriesForType = categories.filter((c) => c.type === (form.type === "INCOME" ? "INCOME" : "EXPENSE"));
  const topLevelCategories = categoriesForType.filter((c) => !c.parentId);
  const childrenByParent = new Map<string, Category[]>();
  for (const c of categoriesForType) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  const transferTargets = accounts.filter((a) => a.id !== form.accountId);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(andAddAnother: boolean) {
    setError(null);
    setIsSubmitting(true);
    try {
      const payload = {
        accountId: form.accountId,
        type: form.type,
        amount: Number(form.amount) || 0,
        date: form.date ? new Date(form.date).toISOString() : undefined,
        categoryId: form.type === "TRANSFER" ? null : form.categoryId || null,
        transferToAccountId: form.type === "TRANSFER" ? form.transferToAccountId : null,
        payee: form.payee.trim() || null,
        notes: form.notes.trim() || null,
      };

      if (isEdit && transaction) {
        await api.patch(`/families/${familyId}/transactions/${transaction.id}`, payload);
      } else {
        await api.post(`/families/${familyId}/transactions`, payload);
      }

      onSaved();
      if (andAddAnother && !isEdit) {
        setForm({ ...emptyForm(accounts), date: form.date });
      } else {
        onClose();
      }
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save transaction"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await submit(false);
  }

  const canSubmit =
    Boolean(form.accountId) &&
    Number(form.amount) > 0 &&
    (form.type !== "TRANSFER" || Boolean(form.transferToAccountId));

  return (
    <Modal title={isEdit ? "Edit transaction" : "Add transaction"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Segmented
          value={form.type}
          onChange={(value) =>
            setForm((f) => ({
              ...f,
              type: value,
              categoryId: "",
              transferToAccountId: value === "TRANSFER" ? f.transferToAccountId : "",
            }))
          }
          options={TRANSACTION_TYPES}
          className="w-full justify-between [&>button]:flex-1"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="txn-date">Date</Label>
            <Input id="txn-date" type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
          </div>
          <div>
            <Label htmlFor="txn-amount">Amount</Label>
            <Input
              id="txn-amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="txn-account">Account</Label>
          <Select
            id="txn-account"
            required
            value={form.accountId}
            onChange={(e) => {
              const next = e.target.value;
              update("accountId", next);
              if (form.transferToAccountId === next) update("transferToAccountId", "");
            }}
          >
            <option value="" disabled>
              Select an account
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>

        {form.type === "TRANSFER" ? (
          <div>
            <Label htmlFor="txn-transfer-to">Transfer to</Label>
            <Select
              id="txn-transfer-to"
              required
              value={form.transferToAccountId}
              onChange={(e) => update("transferToAccountId", e.target.value)}
            >
              <option value="" disabled>
                Select destination account
              </option>
              {transferTargets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div>
            <Label htmlFor="txn-category">Category</Label>
            <Select id="txn-category" value={form.categoryId} onChange={(e) => update("categoryId", e.target.value)}>
              <option value="">No category</option>
              {topLevelCategories.map((parent) => {
                const children = childrenByParent.get(parent.id) ?? [];
                if (children.length === 0) {
                  return (
                    <option key={parent.id} value={parent.id}>
                      {parent.name}
                    </option>
                  );
                }
                return (
                  <optgroup key={parent.id} label={parent.name}>
                    <option value={parent.id}>{parent.name} (general)</option>
                    {children.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="txn-payee">Payee</Label>
          <Input
            id="txn-payee"
            value={form.payee}
            onChange={(e) => update("payee", e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div>
          <Label htmlFor="txn-notes">Notes</Label>
          <Input
            id="txn-notes"
            value={form.notes}
            onChange={(e) => update("notes", e.target.value)}
            placeholder="Optional"
          />
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!isEdit && (
            <Button type="button" variant="secondary" disabled={isSubmitting || !canSubmit} onClick={() => submit(true)}>
              Save & add another
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
