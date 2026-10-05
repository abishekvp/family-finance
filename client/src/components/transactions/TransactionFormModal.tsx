import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRightLeft, HandCoins, Home, Landmark, MinusCircle, PlusCircle, Repeat } from "lucide-react";
import { FAMILY_TRANSFER_TAG, isFamilyTransfer } from "../../lib/transactionTotals";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Chip, ErrorText, Field, Input, Label, Modal, Segmented, Select, useToast } from "../ui";
import { SearchSelect, type SearchSelectOption } from "../SearchSelect";
import type { Account, Category, Transaction, TransactionType } from "../../api/types";
import { currencySymbol, formatCurrency } from "../../lib/format";
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

/**
 * The local calendar day (YYYY-MM-DD). Not toISOString().slice(0, 10): that is the UTC day, so east
 * of UTC an entry made after midnight showed the day before, and saving it moved it there.
 */
function toDateInputValue(iso: string | undefined) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The instant to save for a picked day: the original time if the day didn't change, else local midnight (now for today). */
function dateForSave(day: string, original: Transaction | null | undefined): string | undefined {
  if (!day) return undefined;
  if (original && day === toDateInputValue(original.date)) return original.date;
  if (!original && day === toDateInputValue(undefined)) return new Date().toISOString();
  return new Date(`${day}T00:00:00`).toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** What's still left to refund on `original`, not counting `self`'s own earlier link to it. */
function refundableLeft(original: Transaction, self: Transaction | null | undefined) {
  const own = self && self.refundsId === original.id ? self.amount : 0;
  return Math.max(0, original.amount - (original.refundedAmount ?? (original.isRefunded ? original.amount : 0)) + own);
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
  repeat: import("../../api/types").RecurringFrequency | null;
  /** Money from or to family: moves the balance, but isn't income or spending, and isn't owed back. */
  familyTransfer: boolean;
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
    repeat: null,
    familyTransfer: false,
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
    repeat: null,
    familyTransfer: isFamilyTransfer(t),
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
  // Entries of the opposite type this one could give back: expenses for a refund, incomes for a return.
  const [refundCandidates, setRefundCandidates] = useState<{ type: TransactionType; rows: Transaction[] } | null>(null);
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

  const refundable = form.type === "INCOME" || form.type === "EXPENSE";
  const candidateType: TransactionType = form.type === "INCOME" ? "EXPENSE" : "INCOME";
  useEffect(() => {
    if (!refundable || refundCandidates?.type === candidateType) return;
    let cancelled = false;
    api
      .get<Transaction[]>(`/families/${familyId}/transactions`, { params: { type: candidateType, limit: 500 } })
      .then((res) => !cancelled && setRefundCandidates({ type: candidateType, rows: res.data }))
      .catch(() => !cancelled && setRefundCandidates({ type: candidateType, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [refundable, candidateType, refundCandidates?.type, familyId]);

  const refundOptions = useMemo<SearchSelectOption[]>(() => {
    if (!refundable || refundCandidates?.type !== candidateType) return [];
    const amount = Number(form.amount) || 0;
    const at = form.date ? new Date(`${form.date}T00:00:00`).getTime() : Date.now();
    // Same amount within ten days: almost certainly the one (a verification charge reversed, an order cancelled).
    const suggested = (t: Transaction, left: number) => amount > 0 && Math.abs(left - amount) < 0.005 && Math.abs(new Date(t.date).getTime() - at) <= 10 * DAY_MS;
    return refundCandidates.rows
      .filter((t) => !t.refundsId && t.id !== transaction?.id)
      .map((t) => ({ t, left: refundableLeft(t, transaction) }))
      .filter(({ t, left }) => left > 0.005 || t.id === form.refundsId)
      .sort((a, b) => Number(suggested(b.t, b.left)) - Number(suggested(a.t, a.left)) || b.t.date.localeCompare(a.t.date))
      .map(({ t, left }) => ({
        id: t.id,
        label: `${t.payee || t.category?.name || (t.type === "EXPENSE" ? "Expense" : "Income")} · ${formatCurrency(t.amount, t.account.currency)}`,
        detail: `${suggested(t, left) ? "Same amount · " : ""}${toDateInputValue(t.date)} · ${t.account.name}${
          left < t.amount - 0.005 ? ` · ${formatCurrency(left, t.account.currency)} left` : ""
        }`,
        color: t.category?.color,
        keywords: `${t.amount} ${t.notes ?? ""}`,
      }));
  }, [refundable, refundCandidates, candidateType, form.amount, form.date, form.refundsId, transaction]);

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
  const categoryOptions = useMemo<SearchSelectOption[]>(
    () =>
      topLevelCategories.flatMap((parent) => [
        { id: parent.id, label: parent.name, color: parent.color },
        ...(childrenByParent.get(parent.id) ?? []).map((child) => ({
          id: child.id,
          label: child.name,
          color: child.color,
          indent: true,
          keywords: parent.name,
        })),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, form.type]
  );

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
        date: dateForSave(form.date, transaction),
        // A transfer only keeps a category when it lends to or borrows from a person (the server drops it otherwise).
        categoryId: form.categoryId || null,
        transferToAccountId: form.type === "TRANSFER" ? form.transferToAccountId : null,
        payee: form.payee.trim() || (person && kind ? entryLabel(kind, person.name) : null),
        notes: form.notes.trim() || null,
        refundsId: form.type === "INCOME" || form.type === "EXPENSE" ? form.refundsId || null : null,
        // A return names the loan it pays back; empty means the oldest open loans with that person.
        repaysId: repaying ? form.repaysId || null : null,
        // The kind rides along as a tag (as on mobile), as does a family transfer; other tags are left as they were.
        tags: [
          ...withoutKindTag(transaction?.tags ?? []).filter((tag) => tag !== FAMILY_TRANSFER_TAG),
          ...(kind ? [kindTag(kind)] : []),
          ...(form.familyTransfer && refundable && !person ? [FAMILY_TRANSFER_TAG] : []),
        ],
      };

      const saved =
        isEdit && transaction
          ? await api.patch<Transaction>(`/families/${familyId}/transactions/${transaction.id}`, payload)
          : await api.post<Transaction>(`/families/${familyId}/transactions`, payload);
      
      if (!isEdit && form.repeat && (form.type === "INCOME" || form.type === "EXPENSE") && !person) {
        try {
          await api.post(`/families/${familyId}/recurring`, {
            type: form.type,
            amount: Number(form.amount) || 0,
            accountId: form.accountId,
            categoryId: form.categoryId || null,
            payee: form.payee.trim() || null,
            notes: form.notes.trim() || null,
            frequency: form.repeat,
            startDate: form.date,
            firstTransactionId: saved.data.id,
          });
        } catch (err) {
          toast("Saved, but couldn't make it repeat. " + getErrorMessage(err, "Try again"));
        }
      }

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
    (form.type !== "TRANSFER" || Boolean(form.transferToAccountId));

  const canRepeat = !isEdit && (form.type === "INCOME" || form.type === "EXPENSE") && !person;

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
            setForm((f) => ({
              ...f,
              type: value,
              categoryId: "",
              transferToAccountId: value === "TRANSFER" ? f.transferToAccountId : "",
              // A refund links to the opposite kind of entry, so it can't survive a change of type.
              refundsId: value === f.type ? f.refundsId : "",
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
        ) : (
          <Field label="Category">
            {(props) => (
              <SearchSelect
                {...props}
                options={categoryOptions}
                value={form.categoryId || null}
                onChange={(id) => update("categoryId", id ?? "")}
                placeholder="No category"
                clearLabel="No category"
                searchPlaceholder="Search categories"
                emptyText="No category matches."
              />
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

        {refundable && (refundOptions.length > 0 || form.refundsId) && (
          <Field
            label={form.type === "INCOME" ? "Refund of" : "Return of"}
            hint={
              form.type === "INCOME"
                ? "Money back for something you paid — a cancelled order, a reversed verification charge? It comes off that expense and isn't counted as income."
                : "Handing back money you received — a wrong transfer, a deposit? It comes off that income and isn't counted as spending."
            }
          >
            {(props) => (
              <SearchSelect
                {...props}
                options={refundOptions}
                value={form.refundsId || null}
                onChange={(id) => {
                  update("refundsId", id ?? "");
                  const original = id ? refundCandidates?.rows.find((t) => t.id === id) : undefined;
                  const left = original ? refundableLeft(original, transaction) : 0;
                  const amount = Number(form.amount) || 0;
                  if (left > 0 && (!amount || amount > left)) update("amount", String(Number(left.toFixed(2))));
                }}
                placeholder={form.type === "INCOME" ? "Not a refund" : "Not a return"}
                clearLabel={form.type === "INCOME" ? "Not a refund" : "Not a return"}
                searchPlaceholder="Search by payee, amount or category"
                emptyText="No matching entries."
              />
            )}
          </Field>
        )}

        {refundable && !person && (
          <div className="space-y-1.5">
            <Chip selected={form.familyTransfer} onClick={() => update("familyTransfer", !form.familyTransfer)}>
              <Home size={13} />
              {form.type === "INCOME" ? "From family — not income" : "To family — not spending"}
            </Chip>
            {form.familyTransfer && (
              <p className="text-xs text-ink-subtle">
                {form.type === "INCOME"
                  ? "Added to the account's balance, but not counted as income — and nobody owes it back."
                  : "Taken from the account's balance, but not counted as spending or in budgets — and nobody owes it back."}
              </p>
            )}
          </div>
        )}

        {canRepeat && (
          <div>
            <Label>Repeat</Label>
            <p className="mb-2 text-xs text-ink-subtle">
              {form.repeat ? "Recorded automatically on schedule. You can change it later." : `Set up a repeating payment starting ${form.date || "today"}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip type="button" selected={!form.repeat} onClick={() => update("repeat", null)}>
                Don't repeat
              </Chip>
              <Chip type="button" selected={form.repeat === "WEEKLY"} onClick={() => update("repeat", "WEEKLY")}>
                <span className="flex items-center gap-1.5"><Repeat size={12} /> Weekly</span>
              </Chip>
              <Chip type="button" selected={form.repeat === "MONTHLY"} onClick={() => update("repeat", "MONTHLY")}>
                <span className="flex items-center gap-1.5"><Repeat size={12} /> Monthly</span>
              </Chip>
              <Chip type="button" selected={form.repeat === "YEARLY"} onClick={() => update("repeat", "YEARLY")}>
                <span className="flex items-center gap-1.5"><Repeat size={12} /> Yearly</span>
              </Chip>
            </div>
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
