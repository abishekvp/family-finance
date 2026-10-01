import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRightLeft, HandCoins, Landmark, MinusCircle, PlusCircle } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Checkbox, Chip, ErrorText, Field, Input, Label, Modal, Segmented, Select, useToast } from "../ui";
import type { Account, Category, Transaction, TransactionType } from "../../api/types";
import { currencySymbol } from "../../lib/format";
import {
  LENDING_KIND_LABELS,
  entryLabel,
  isPerson,
  kindOf,
  kindTag,
  loanLabel,
  repaidDirection,
  trackLoans,
  withoutKindTag,
  type LendingKind,
} from "../../lib/lending";

const TRANSACTION_TYPES: { value: TransactionType; label: ReactNode }[] = [
  {
    value: "INCOME",
    label: (
      <span className="flex items-center justify-center gap-1.5">
        <PlusCircle size={14} />
        Income
      </span>
    ),
  },
  {
    value: "EXPENSE",
    label: (
      <span className="flex items-center justify-center gap-1.5">
        <MinusCircle size={14} />
        Expense
      </span>
    ),
  },
  {
    value: "TRANSFER",
    label: (
      <span className="flex items-center justify-center gap-1.5">
        <ArrowRightLeft size={14} />
        Transfer
      </span>
    ),
  },
];

const TYPE_TONE: Record<TransactionType, string> = {
  INCOME: "text-income",
  EXPENSE: "text-expense",
  TRANSFER: "text-brand-600",
};

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
  refundsId: string;
  repaysId: string;
}

/** A new transaction starts on the first real account — never on a friend's lend & borrow tab. */
function defaultAccountId(accounts: Account[]) {
  return (accounts.find((a) => a.type !== "PERSON") ?? accounts[0])?.id ?? "";
}

function emptyForm(accounts: Account[]): FormState {
  return {
    type: "EXPENSE",
    accountId: defaultAccountId(accounts),
    transferToAccountId: "",
    categoryId: "",
    amount: "",
    date: toDateInputValue(undefined),
    payee: "",
    notes: "",
    refundsId: "",
    repaysId: "",
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
    refundsId: t.refundsId ?? "",
    repaysId: t.repaysId ?? "",
  };
}

// Add/Edit form for a single transaction — the single most-used interaction in the app.
// Reused by the Transactions hub (floating add button + row tap) and Dashboard's quick-add.
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
  onSaved: (saved: Transaction) => void;
}) {
  const isEdit = Boolean(transaction);
  const [form, setForm] = useState<FormState>(() =>
    transaction ? formFromTransaction(transaction) : emptyForm(accounts)
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefund, setIsRefund] = useState(Boolean(transaction?.refundsId));
  const [refundableExpenses, setRefundableExpenses] = useState<Transaction[] | null>(null);
  const [isLoadingRefundables, setIsLoadingRefundables] = useState(false);
  const toast = useToast();
  // Which way a transfer with a person runs decides its options; "kind" says if it starts or returns a loan.
  const [kindChoice, setKindChoice] = useState<LendingKind | null>(() => {
    if (!transaction || transaction.type !== "TRANSFER") return null;
    const personId = [transaction.accountId, transaction.transferToAccountId].find((id) => accounts.find((a) => a.id === id && isPerson(a)));
    return personId ? kindOf(transaction, personId) : null;
  });
  const [personHistory, setPersonHistory] = useState<Transaction[]>([]);

  useEffect(() => {
    if (!form.accountId && accounts.length > 0) {
      setForm((f) => ({ ...f, accountId: defaultAccountId(accounts) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  useEffect(() => {
    if (!isRefund || refundableExpenses !== null) return;
    setIsLoadingRefundables(true);
    api
      .get<Transaction[]>(`/families/${familyId}/transactions`, { params: { type: "EXPENSE", limit: 100 } })
      .then((res) => setRefundableExpenses(res.data))
      .catch(() => setRefundableExpenses([]))
      .finally(() => setIsLoadingRefundables(false));
  }, [isRefund, refundableExpenses, familyId]);

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
  const flatCategoryChoices = categoriesForType.length <= 14;

  // People (lend & borrow tabs) are transfer ends; for income and expenses they only show once
  // chosen, e.g. "a friend paid for this".
  const sourceAccounts = accounts.filter((a) => a.type !== "PERSON" || form.type === "TRANSFER" || a.id === form.accountId);
  const transferTargets = accounts.filter((a) => a.id !== form.accountId);
  const selectedAccount = accounts.find((a) => a.id === form.accountId);
  const symbol = currencySymbol(selectedAccount?.currency ?? "USD");

  // A transfer between one of your accounts and a person is a loan entry.
  const fromAccount = accounts.find((a) => a.id === form.accountId);
  const toAccount = accounts.find((a) => a.id === form.transferToAccountId);
  const person =
    form.type === "TRANSFER" && fromAccount && toAccount && isPerson(fromAccount) !== isPerson(toAccount)
      ? isPerson(fromAccount)
        ? fromAccount
        : toAccount
      : null;
  const moneyToPerson = !!person && person.id === toAccount?.id;
  const kindOptions: LendingKind[] = moneyToPerson ? ["lent", "paid-back"] : ["borrowed", "got-back"];
  const kind: LendingKind | null = person ? (kindChoice && kindOptions.includes(kindChoice) ? kindChoice : kindOptions[0]) : null;
  const repaying = kind ? repaidDirection(kind) : null;
  const personId = person?.id ?? null;

  useEffect(() => {
    if (!repaying || !personId) {
      setPersonHistory([]);
      return;
    }
    let cancelled = false;
    api
      .get<Transaction[]>(`/families/${familyId}/transactions`, { params: { accountId: personId, limit: 5000 } })
      .then((res) => !cancelled && setPersonHistory(res.data))
      .catch(() => !cancelled && setPersonHistory([]));
    return () => {
      cancelled = true;
    };
  }, [repaying, personId, familyId]);

  // The loans this return can pay back, as they stood before this entry (its own earlier save is left out).
  const openLoans = useMemo(() => {
    if (!repaying || !person) return [];
    const history = personHistory.filter((t) => t.id !== transaction?.id);
    return trackLoans(history, person).filter((l) => l.transaction && l.direction === repaying && (!l.settled || l.transaction.id === form.repaysId));
  }, [repaying, person, personHistory, transaction?.id, form.repaysId]);

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
        // A transfer only keeps a category when it lends to or borrows from a person (the server drops it otherwise).
        categoryId: form.categoryId || null,
        transferToAccountId: form.type === "TRANSFER" ? form.transferToAccountId : null,
        payee: form.payee.trim() || (person && kind ? entryLabel(kind, person.name) : null),
        notes: form.notes.trim() || null,
        refundsId: form.type === "INCOME" && isRefund ? form.refundsId || null : null,
        // A return names the loan it pays back; empty means the oldest open loans with that person.
        repaysId: repaying ? form.repaysId || null : null,
        // The kind rides along as a tag (as on mobile); other tags are left as they were.
        tags: [...withoutKindTag(transaction?.tags ?? []), ...(kind ? [kindTag(kind)] : [])],
      };

      const saved =
        isEdit && transaction
          ? await api.patch<Transaction>(`/families/${familyId}/transactions/${transaction.id}`, payload)
          : await api.post<Transaction>(`/families/${familyId}/transactions`, payload);
      // Saved, but it won't show in totals until an admin approves it.
      if (saved.data.approvalStatus === "PENDING") toast("Saved and sent to an admin for approval");

      onSaved(saved.data);
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
    (form.type !== "TRANSFER" || Boolean(form.transferToAccountId)) &&
    (form.type !== "INCOME" || !isRefund || Boolean(form.refundsId));

  return (
    <Modal
      title={isEdit ? "Edit transaction" : "Add transaction"}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!isEdit && (
            <Button
              type="button"
              variant="secondary"
              disabled={isSubmitting || !canSubmit}
              onClick={() => submit(true)}
            >
              Save &amp; add another
            </Button>
          )}
          <Button type="submit" form="transaction-form" loading={isSubmitting} disabled={!canSubmit}>
            Save
          </Button>
        </div>
      }
    >
      <form id="transaction-form" onSubmit={handleSubmit} className="space-y-5">
        <Segmented
          value={form.type}
          onChange={(value) => {
            if (value !== "INCOME") setIsRefund(false);
            setForm((f) => ({
              ...f,
              type: value,
              categoryId: "",
              transferToAccountId: value === "TRANSFER" ? f.transferToAccountId : "",
              refundsId: value === "INCOME" ? f.refundsId : "",
            }));
          }}
          options={TRANSACTION_TYPES}
          className="w-full [&>button]:flex-1"
        />

        <div className="rounded-2xl border border-line bg-surface-sunken/60 px-4 py-5 text-center">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Amount</p>
          <div className={`flex items-center justify-center gap-1.5 text-4xl font-extrabold tracking-tight ${TYPE_TONE[form.type]}`}>
            <span className="text-2xl opacity-70">{symbol}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              autoFocus={!isEdit}
              value={form.amount}
              onChange={(e) => update("amount", e.target.value)}
              placeholder="0.00"
              className="w-40 bg-transparent text-center tabular-nums outline-none placeholder:text-ink-subtle/50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            {(props) => (
              <Input {...props} type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
            )}
          </Field>
          <Field label="Payee">
            {(props) => (
              <Input
                {...props}
                value={form.payee}
                onChange={(e) => update("payee", e.target.value)}
                placeholder="Optional"
              />
            )}
          </Field>
        </div>

        <div>
          <Label>Account</Label>
          <div className="flex flex-wrap gap-2">
            {sourceAccounts.map((a) => (
              <Chip
                key={a.id}
                type="button"
                selected={form.accountId === a.id}
                onClick={() => {
                  update("accountId", a.id);
                  if (form.transferToAccountId === a.id) update("transferToAccountId", "");
                }}
              >
                {a.type === "PERSON" ? <HandCoins size={12} /> : <Landmark size={12} />}
                {a.name}
              </Chip>
            ))}
          </div>
        </div>

        {form.type === "TRANSFER" ? (
          <div>
            <Label>Transfer to</Label>
            <div className="flex flex-wrap gap-2">
              {transferTargets.length === 0 ? (
                <p className="text-xs text-ink-subtle">No other account to transfer to yet.</p>
              ) : (
                transferTargets.map((a) => (
                  <Chip
                    key={a.id}
                    type="button"
                    selected={form.transferToAccountId === a.id}
                    onClick={() => update("transferToAccountId", a.id)}
                  >
                    {a.name}
                  </Chip>
                ))
              )}
            </div>
          </div>
        ) : flatCategoryChoices ? (
          <div>
            <Label>Category</Label>
            <div className="flex flex-wrap gap-2">
              <Chip type="button" selected={!form.categoryId} onClick={() => update("categoryId", "")}>
                None
              </Chip>
              {topLevelCategories.map((parent) => {
                const children = childrenByParent.get(parent.id) ?? [];
                return [parent, ...children].map((c) => (
                  <Chip
                    key={c.id}
                    type="button"
                    color={c.color}
                    selected={form.categoryId === c.id}
                    onClick={() => update("categoryId", c.id)}
                  >
                    {c.id === parent.id && children.length > 0 ? `${c.name} (general)` : c.name}
                  </Chip>
                ));
              })}
            </div>
          </div>
        ) : (
          <Field label="Category">
            {(props) => (
              <Select {...props} value={form.categoryId} onChange={(e) => update("categoryId", e.target.value)}>
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
            )}
          </Field>
        )}

        {person && kind && (
          <div className="space-y-3">
            <div>
              <Label>This is</Label>
              <div className="flex flex-wrap gap-2">
                {kindOptions.map((k) => (
                  <Chip
                    key={k}
                    type="button"
                    selected={kind === k}
                    onClick={() => {
                      setKindChoice(k);
                      update("repaysId", "");
                    }}
                  >
                    {LENDING_KIND_LABELS[k]}
                  </Chip>
                ))}
              </div>
            </div>
            {repaying && openLoans.length > 0 && (
              <Field label="Pays back" hint="Link it to the loan it returns, so that loan is marked as returned.">
                {(props) => (
                  <Select {...props} value={form.repaysId} onChange={(e) => update("repaysId", e.target.value)}>
                    <option value="">Oldest loans first</option>
                    {openLoans.map((loan) => (
                      <option key={loan.transaction!.id} value={loan.transaction!.id}>
                        {loanLabel(loan, person.currency)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
        )}

        {form.type === "INCOME" && (
          <div>
            <Checkbox
              label="This is a refund"
              description="Money back for an expense you already recorded — it and the original are left out of income and spending totals."
              checked={isRefund}
              onChange={(e) => {
                setIsRefund(e.target.checked);
                if (!e.target.checked) update("refundsId", "");
              }}
            />
            {isRefund && (
              <div className="mt-3">
                <Field label="Refund of">
                  {(props) =>
                    isLoadingRefundables ? (
                      <p className="text-xs text-ink-subtle">Loading expenses…</p>
                    ) : (
                      <Select {...props} value={form.refundsId} onChange={(e) => update("refundsId", e.target.value)}>
                        <option value="">Select the expense being refunded</option>
                        {(refundableExpenses ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {toDateInputValue(t.date)} · {t.payee || t.category?.name || "Expense"} ·{" "}
                            {currencySymbol(t.account.currency)}
                            {t.amount.toFixed(2)}
                            {t.isRefunded ? " (already refunded)" : ""}
                          </option>
                        ))}
                      </Select>
                    )
                  }
                </Field>
              </div>
            )}
          </div>
        )}

        <Field label="Notes" hint="Optional">
          {(props) => (
            <Input {...props} value={form.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Add a note" />
          )}
        </Field>

        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}
