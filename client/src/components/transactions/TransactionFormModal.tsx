import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowRightLeft, HandCoins, Home, Landmark, MinusCircle, Plus, PlusCircle, Repeat, Trash2 } from "lucide-react";
import { isFamilyTransfer } from "../../lib/transactionTotals";
import { api } from "../../api/client";
import { ClientError, getErrorMessage } from "../../api/errors";
import { Button, Chip, ErrorText, Field, Input, Label, Modal, Segmented, Toggle, cn, useToast } from "../ui";
import { SearchSelect, type SearchSelectOption } from "../SearchSelect";
import { CategoryPicker } from "../CategoryPicker";
import { NewCategoryForm } from "../NewCategoryForm";
import type { Account, Budget, Category, PayeeRule, RecurringFrequency, Transaction, TransactionType } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useFamilyData, useRecentHistory } from "../../context/FamilyDataContext";
import { currencySymbol, formatCurrency } from "../../lib/format";
import { MONTH_LABELS, localDateInput } from "../../lib/dateUtils";
import { budgetName } from "../../lib/budgets";
import { FREQUENCIES, describeSchedule } from "../../lib/recurring";
import {
  LENDING_KINDS,
  balanceEffect,
  describeBalance,
  describeEntry,
  entryLabel,
  isPerson,
  kindOf,
  kindTag,
  loanLabel,
  moneyGoesOut,
  parseKind,
  repaidDirection,
  startsLoan,
  trackLoans,
  withoutKindTag,
  type LendingKind,
} from "../../lib/lending";
import {
  createPayeeRule,
  describeTarget,
  fetchPayeeRules,
  findRule,
  learnMappings,
  matchCategory,
  normalizePayee,
  seriesKey,
  tagsWithTarget,
  updatePayeeRule,
} from "../../lib/payeeRules";

/** "LENDING" is saved as a transfer between one of your accounts and a person. */
export type FormType = TransactionType | "LENDING";

/** Presets for a new entry (the mobile app's transaction-form params). */
export interface TransactionPreset {
  type?: FormType;
  accountId?: string;
  personId?: string;
  kind?: LendingKind;
  amount?: number;
  repaysId?: string;
  refundsId?: string;
}

const TYPE_OPTIONS: { value: FormType; label: ReactNode }[] = [
  { value: "INCOME", label: <TypeLabel icon={<PlusCircle size={14} />} text="Income" /> },
  { value: "EXPENSE", label: <TypeLabel icon={<MinusCircle size={14} />} text="Expense" /> },
  { value: "TRANSFER", label: <TypeLabel icon={<ArrowRightLeft size={14} />} text="Transfer" /> },
  { value: "LENDING", label: <TypeLabel icon={<HandCoins size={14} />} text="Lend/Borrow" /> },
];

function TypeLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex items-center justify-center gap-1.5">
      <span className="hidden sm:inline-flex">{icon}</span>
      {text}
    </span>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function todayIso() {
  return localDateInput(new Date());
}

/** A YYYY-MM-DD day as local midnight, or null when it isn't a date. */
function parseDay(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** What's still left to refund on `original`, not counting `self`'s own earlier link to it. */
function refundableLeft(original: Transaction, self: Transaction | null | undefined) {
  const own = self && self.refundsId === original.id ? self.amount : 0;
  return Math.max(0, original.amount - (original.refundedAmount ?? (original.isRefunded ? original.amount : 0)) + own);
}

// Add/Edit form for a single transaction — the single most-used interaction in the app, mirroring the
// mobile app's transaction form option for option. Used by the Transactions hub, Dashboard, Approvals,
// Lend & borrow and the uncategorised review.
export function TransactionFormModal({
  familyId,
  accounts,
  categories: baseCategories,
  transaction,
  preset,
  onClose,
  onSaved,
}: {
  familyId: string;
  accounts: Account[];
  categories: Category[];
  transaction?: Transaction | null;
  preset?: TransactionPreset;
  onClose: () => void;
  /** After a save or a delete, with the entry concerned (its date says which cached year changed). */
  onSaved: (saved: Transaction) => void;
}) {
  const { user } = useAuth();
  const family = user!.families.find((f) => f.id === familyId) ?? user!.families[0];
  const { refreshAccounts, refreshCategories } = useFamilyData();
  const toast = useToast();
  const navigate = useNavigate();

  const initial = transaction ?? null;
  const isEdit = !!initial;
  const [createdCategories, setCreatedCategories] = useState<Category[]>([]);
  const categories = useMemo(
    () => [...baseCategories, ...createdCategories.filter((c) => !baseCategories.some((b) => b.id === c.id))],
    [baseCategories, createdCategories]
  );

  const [type, setType] = useState<FormType>(initial?.type ?? preset?.type ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? preset?.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  // Money from or to family: moves the balance, but isn't income or spending and isn't owed back.
  const [familyTransfer, setFamilyTransfer] = useState(initial ? isFamilyTransfer(initial) : false);
  // Once the user picks a category (or family transfer) themselves, the payee stops filling it in.
  const [targetTouched, setTargetTouched] = useState(!!initial && (!!initial.categoryId || isFamilyTransfer(initial)));
  const [rememberPayee, setRememberPayee] = useState(false);
  const [transferToAccountId, setTransferToAccountId] = useState<string | null>(initial?.transferToAccountId ?? null);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : preset?.amount ? String(Number(preset.amount.toFixed(2))) : "");
  // Local day, not initial.date.slice(0, 10): that is the UTC day, and re-saving it would shift the
  // transaction back a day east of UTC.
  const [date, setDate] = useState(initial ? localDateInput(new Date(initial.date)) : todayIso());
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const canDelete = isEdit && family.role !== "VIEWER";

  // Lend & borrow: `accountId` is always your own account; the person is the other end.
  const [kind, setKind] = useState<LendingKind>(parseKind(preset?.kind) ?? "lent");
  const [personId, setPersonId] = useState<string | null>(preset?.personId ?? null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [sharePerson, setSharePerson] = useState(false);
  const [dueDate, setDueDate] = useState(initial?.dueDate ? localDateInput(new Date(initial.dueDate)) : "");
  // A return pays back this lend/borrow entry first; null matches it to the oldest open loans.
  const [repaysId, setRepaysId] = useState<string | null>(initial?.repaysId ?? preset?.repaysId ?? null);
  const [refundsId, setRefundsId] = useState<string | null>(initial?.refundsId ?? preset?.refundsId ?? null);
  const [addingCategory, setAddingCategory] = useState(false);
  // A person created by a save whose transaction then failed — reused on retry, never created twice.
  const createdPerson = useRef<Account | null>(null);
  // "Repeat" on a new income or expense: this transaction becomes the first of a repeating payment.
  const [repeat, setRepeat] = useState<RecurringFrequency | null>(null);
  // Saved on an attempt whose repeating schedule (or payee rule) then failed; a retry doesn't save it twice.
  const savedTransaction = useRef<Transaction | null>(null);
  const didInitFromAccounts = useRef(false);

  // Once accounts are known: a transfer with a person opens as Lend/Borrow, and a new entry starts on
  // a real account, never on a person.
  useEffect(() => {
    if (accounts.length === 0 || didInitFromAccounts.current) return;
    didInitFromAccounts.current = true;
    const people = accounts.filter(isPerson);
    if (initial?.type === "TRANSFER") {
      const person = people.find((p) => p.id === initial.accountId || p.id === initial.transferToAccountId);
      if (person) {
        setType("LENDING");
        setPersonId(person.id);
        setAccountId(person.id === initial.accountId ? initial.transferToAccountId ?? "" : initial.accountId);
        setKind(kindOf(initial, person.id));
        return;
      }
    }
    if (!initial && preset?.type === "LENDING" && people.length === 0) setAddingPerson(true);
  }, [accounts, initial, preset?.type]);

  useEffect(() => {
    if (accountId || accounts.length === 0) return;
    setAccountId((accounts.find((a) => !isPerson(a)) ?? accounts[0]).id);
  }, [accounts, accountId]);

  const isLending = type === "LENDING";
  const people = accounts.filter(isPerson);
  const ownAccounts = accounts.filter((a) => !isPerson(a));
  const categoriesForType = isLending
    ? [...categories.filter((c) => c.type === "EXPENSE"), ...categories.filter((c) => c.type === "INCOME")]
    : categories.filter((c) => c.type === (type === "TRANSFER" ? "EXPENSE" : type));
  // People are reached through Lend/Borrow. For income and expenses one only shows once chosen, e.g.
  // from a person's "paid for something".
  const sourceAccounts = isLending ? ownAccounts : accounts.filter((a) => !isPerson(a) || a.id === accountId);
  const transferTargets = accounts.filter((a) => a.id !== accountId && (!isPerson(a) || a.id === transferToAccountId));
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const paidByPerson = selectedAccount && isPerson(selectedAccount) && !isLending && type !== "TRANSFER" ? selectedAccount : null;
  // A salary, rent or subscription can be set to repeat as it's added (not from a person's account).
  const canRepeat = !isEdit && (type === "INCOME" || type === "EXPENSE") && !paidByPerson;
  const symbol = currencySymbol(selectedAccount?.currency ?? family.currency);

  const person = isLending && !addingPerson ? people.find((p) => p.id === personId) ?? null : null;
  const personName = addingPerson ? newPersonName.trim() : person?.name ?? "";
  const hasPerson = addingPerson ? personName.length > 0 : !!person;

  // A return can say which loan it pays back. This entry's own earlier save is left out, so the loans
  // read as they stood before it.
  const repaying = isLending && person ? repaidDirection(kind) : null;
  const personLoanId = repaying ? person!.id : null;
  const [personHistory, setPersonHistory] = useState<Transaction[]>([]);
  useEffect(() => {
    if (!personLoanId) {
      setPersonHistory([]);
      return;
    }
    let cancelled = false;
    api
      .get<Transaction[]>(`/families/${familyId}/transactions`, { params: { accountId: personLoanId, limit: 5000 } })
      .then((res) => !cancelled && setPersonHistory(res.data))
      .catch(() => !cancelled && setPersonHistory([]));
    return () => {
      cancelled = true;
    };
  }, [personLoanId, familyId]);
  const openLoans = useMemo(() => {
    if (!repaying || !person) return [];
    const history = personHistory.filter((t) => t.id !== initial?.id && (t.accountId === person.id || t.transferToAccountId === person.id));
    return trackLoans(history, person).filter((l) => l.transaction && l.direction === repaying && (!l.settled || l.transaction.id === repaysId));
  }, [repaying, person, personHistory, initial?.id, repaysId]);
  const linkedLoan = openLoans.find((l) => l.transaction!.id === repaysId) ?? null;

  // A refund (income) gives back an expense; a return (expense) gives back an income.
  const refundable = type === "INCOME" || type === "EXPENSE" ? type : null;
  const candidateType: TransactionType | null = refundable ? (refundable === "INCOME" ? "EXPENSE" : "INCOME") : null;
  const [refundCandidates, setRefundCandidates] = useState<{ type: TransactionType; rows: Transaction[] } | null>(null);
  useEffect(() => {
    if (!candidateType || refundCandidates?.type === candidateType) return;
    let cancelled = false;
    api
      .get<Transaction[]>(`/families/${familyId}/transactions`, { params: { type: candidateType, limit: 500 } })
      .then((res) => !cancelled && setRefundCandidates({ type: candidateType, rows: res.data }))
      .catch(() => !cancelled && setRefundCandidates({ type: candidateType, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [candidateType, refundCandidates?.type, familyId]);

  const amountValue = Number(amount);
  const dateDay = parseDay(date);

  const refundOptions = useMemo<SearchSelectOption[]>(() => {
    if (!candidateType || refundCandidates?.type !== candidateType) return [];
    const at = dateDay?.getTime() ?? Date.now();
    // Same amount within ten days: almost certainly the one (a verification charge reversed, an order cancelled).
    const suggested = (t: Transaction, left: number) =>
      amountValue > 0 && Math.abs(left - amountValue) < 0.005 && Math.abs(new Date(t.date).getTime() - at) <= 10 * DAY_MS;
    return refundCandidates.rows
      .filter((t) => !t.isDeleted && !t.refundsId && t.id !== initial?.id)
      .map((t) => ({ t, left: refundableLeft(t, initial) }))
      .filter(({ t, left }) => left > 0.005 || t.id === refundsId)
      .sort((a, b) => Number(suggested(b.t, b.left)) - Number(suggested(a.t, a.left)) || b.t.date.localeCompare(a.t.date))
      .slice(0, 300)
      .map(({ t, left }) => ({
        id: t.id,
        label: `${t.payee || t.category?.name || (t.type === "EXPENSE" ? "Expense" : "Income")} · ${formatCurrency(t.amount, t.account.currency)}`,
        detail: `${suggested(t, left) ? "Same amount · " : ""}${new Date(t.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · ${t.account.name}${
          left < t.amount - 0.005 ? ` · ${formatCurrency(left, t.account.currency)} left` : ""
        }`,
        color: t.category?.color,
        keywords: `${t.amount} ${t.category?.name ?? ""} ${t.notes ?? ""}`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateType, refundCandidates, amountValue, date, refundsId, initial]);

  // New categories are income or expense; for Lend/Borrow, by which way the money went.
  const newCategoryType = isLending ? (moneyGoesOut(kind) ? "EXPENSE" : "INCOME") : type === "INCOME" ? "INCOME" : "EXPENSE";

  // Payee → category: the family's payee rules, then how this payee was filed before.
  const [payeeRules, setPayeeRules] = useState<PayeeRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchPayeeRules(familyId).then(
      (rules) => !cancelled && setPayeeRules(rules),
      () => undefined
    );
    return () => {
      cancelled = true;
    };
  }, [familyId]);
  const { data: history } = useRecentHistory();
  const learned = useMemo(() => learnMappings(history.filter((t) => t.id !== initial?.id), categories), [history, categories, initial?.id]);
  const filedByPayee = type === "INCOME" || type === "EXPENSE";
  const payeeMatch = useMemo(
    () => (filedByPayee ? matchCategory(payee, type, payeeRules, learned) : null),
    [filedByPayee, payee, type, payeeRules, learned]
  );
  const autoFilled = useRef(false);
  useEffect(() => {
    if (targetTouched) return;
    if (payeeMatch) {
      const category = payeeMatch.categoryId ? categories.find((c) => c.id === payeeMatch.categoryId && c.type === type) : null;
      setCategoryId(category?.id ?? null);
      setFamilyTransfer(payeeMatch.familyTransfer);
      autoFilled.current = true;
    } else if (autoFilled.current) {
      // The payee changed to one with no match: take back what the last one filled in.
      setCategoryId(null);
      setFamilyTransfer(false);
      autoFilled.current = false;
    }
  }, [payeeMatch, targetTouched, categories, type]);

  function pickCategory(id: string | null) {
    setTargetTouched(true);
    setCategoryId(id);
  }
  function toggleFamilyTransfer() {
    setTargetTouched(true);
    setFamilyTransfer((v) => !v);
  }

  // "Remember this": files later entries from this payee the same way, through a payee rule.
  const rememberPattern = seriesKey(payee) || normalizePayee(payee);
  const existingRule = filedByPayee && payee.trim() ? findRule(payeeRules, payee, type as "INCOME" | "EXPENSE") : null;
  const canRemember =
    filedByPayee &&
    family.role !== "VIEWER" &&
    rememberPattern.length >= 2 &&
    (!!categoryId || familyTransfer) &&
    !(existingRule && existingRule.categoryId === categoryId && existingRule.familyTransfer === familyTransfer);
  // The same pattern saved before is changed rather than doubled.
  const sameRule = existingRule && normalizePayee(existingRule.payee) === rememberPattern ? existingRule : null;
  const rememberTarget = describeTarget({ category: categories.find((c) => c.id === categoryId) ?? null, familyTransfer });

  async function savePayeeRule() {
    const input = { payee: rememberPattern, type: type as "INCOME" | "EXPENSE", categoryId, familyTransfer };
    const saved = sameRule ? await updatePayeeRule(familyId, sameRule.id, input) : await createPayeeRule(familyId, input);
    setPayeeRules((list) => [...list.filter((r) => r.id !== saved.id), saved]);
  }

  const canSubmit =
    !!accountId &&
    amount.trim().length > 0 &&
    amountValue > 0 &&
    date.trim().length > 0 &&
    (type !== "TRANSFER" || (!!transferToAccountId && transferToAccountId !== accountId)) &&
    (!isLending || (hasPerson && !!selectedAccount && !isPerson(selectedAccount)));

  // Where the person stands after this entry. An edited entry is already in their balance, so take it out first.
  const lendingPreview = (() => {
    if (!isLending || !hasPerson || !(amountValue > 0)) return null;
    let before = person?.balance ?? 0;
    if (person && initial?.type === "TRANSFER" && (initial.accountId === person.id || initial.transferToAccountId === person.id)) {
      before -= describeEntry(initial, person.id).effect;
    }
    return describeBalance(personName, before + balanceEffect(kind, amountValue), person?.currency ?? family.currency);
  })();

  // The budgets an expense counts in: those for its date's month, and the yearly ones.
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const budgetYear = dateDay?.getFullYear();
  const budgetMonth = dateDay ? dateDay.getMonth() + 1 : undefined;
  // Money sent to family isn't spending, so it doesn't come out of a budget.
  const wantsBudgets = type === "EXPENSE" && !familyTransfer;
  useEffect(() => {
    if (!wantsBudgets || !budgetYear || !budgetMonth) return;
    let cancelled = false;
    const url = `/families/${familyId}/budgets`;
    const tzOffset = new Date().getTimezoneOffset();
    Promise.all([
      api.get<Budget[]>(url, { params: { year: budgetYear, month: budgetMonth, tzOffset } }),
      api.get<Budget[]>(url, { params: { year: budgetYear, period: "ANNUAL", tzOffset } }),
    ])
      .then(([monthRes, yearRes]) => !cancelled && setBudgets([...monthRes.data, ...yearRes.data]))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [familyId, wantsBudgets, budgetYear, budgetMonth]);

  /** A budget's category and its subcategories: what it counts. */
  function budgetCategoryIds(b: Budget) {
    return [b.categoryId, ...categories.filter((c) => c.parentId === b.categoryId).map((c) => c.id)];
  }
  // Only budgets whose category can still be picked (a deleted category's budget can't take new entries).
  const budgetChoices = budgets.filter((b) => categories.some((c) => c.id === b.categoryId));
  const countsIn = wantsBudgets && categoryId ? budgetChoices.filter((b) => budgetCategoryIds(b).includes(categoryId)) : [];
  /** What a budget has left once this expense is in it. An edited expense is already in its spent. */
  function leftAfter(b: Budget) {
    let left = b.remaining;
    if (initial?.type === "EXPENSE" && initial.categoryId && budgetCategoryIds(b).includes(initial.categoryId)) {
      const at = new Date(initial.date);
      const samePeriod = at.getFullYear() === b.year && (b.period === "ANNUAL" || at.getMonth() + 1 === b.month);
      if (samePeriod) left += initial.amount;
    }
    return left - (amountValue > 0 ? amountValue : 0);
  }
  const budgetHints = countsIn.map((b) => {
    const left = leftAfter(b);
    const when = b.period === "ANNUAL" ? `in ${b.year}` : `in ${MONTH_LABELS[(b.month ?? 1) - 1]}`;
    return left >= 0
      ? `${budgetName(b)} ${when}: ${formatCurrency(left, family.currency)} left after this`
      : `Takes ${budgetName(b)} over by ${formatCurrency(-left, family.currency)} ${when}`;
  });
  const overBudget = countsIn.some((b) => leftAfter(b) < 0);

  /**
   * Money someone returned, or money you're returning, recorded as plain income or an expense: turn it
   * into a Lend/Borrow return so it settles the loan instead of counting as income or spending.
   */
  const canBeLoanReturn = (type === "INCOME" || type === "EXPENSE") && !paidByPerson && !initial?.recurringId;
  function recordAsLending(nextKind: LendingKind) {
    const typedName = payee.trim().toLowerCase();
    const match = typedName ? people.find((p) => p.name.trim().toLowerCase() === typedName) : undefined;
    handleSelectType("LENDING");
    setKind(nextKind);
    setRepaysId(null);
    if (match) {
      setAddingPerson(false);
      setPersonId(match.id);
    }
  }

  function handleSelectType(next: FormType) {
    // A refund links to the opposite kind of entry, so the link can't survive a change of type.
    if (next !== type) setRefundsId(null);
    setType(next);
    if (next === "TRANSFER") setCategoryId(null);
    else if (next !== "LENDING") {
      // Lend/Borrow may use any category; income and expenses only their own kind.
      const current = categories.find((c) => c.id === categoryId);
      if (current && current.type !== next) setCategoryId(null);
    }
    if (next !== "TRANSFER") setTransferToAccountId(null);
    if (next === "LENDING") {
      if (selectedAccount && isPerson(selectedAccount)) setAccountId(ownAccounts[0]?.id ?? "");
      if (people.length === 0) setAddingPerson(true);
    }
  }

  function handleSelectAccount(id: string) {
    setAccountId(id);
    if (transferToAccountId === id) setTransferToAccountId(null);
  }

  /** Checks the dates before anything is saved (or a new person created). */
  function validateDates() {
    if (!parseDay(date)) {
      setError("Pick the transaction's date");
      return false;
    }
    if (isLending && startsLoan(kind) && dueDate.trim() && !parseDay(dueDate)) {
      setError("Pick a valid return-by date");
      return false;
    }
    return true;
  }

  /** The request body; dates must already be valid (see validateDates). */
  function buildPayload(personAccountId: string | null): Record<string, unknown> {
    const trimmedDate = date.trim();
    const parsed = parseDay(trimmedDate)!;
    const payloadRepaysId = repaying ? repaysId : null;
    // Keep the original time (SMS imports carry the alert's) unless the day itself was changed. A new
    // entry for today keeps the current time, so it sorts after today's earlier ones.
    const unchangedDay = initial && trimmedDate === localDateInput(new Date(initial.date));
    const isoDate = unchangedDay ? initial.date : !initial && trimmedDate === todayIso() ? new Date().toISOString() : parsed.toISOString();

    if (isLending) {
      const due = startsLoan(kind) && dueDate.trim() ? parseDay(dueDate)!.toISOString() : null;
      const out = moneyGoesOut(kind);
      return {
        type: "TRANSFER",
        accountId: out ? accountId : personAccountId,
        transferToAccountId: out ? personAccountId : accountId,
        amount: amountValue,
        date: isoDate,
        categoryId,
        payee: entryLabel(kind, personName),
        notes: notes.trim() || null,
        dueDate: due,
        repaysId: payloadRepaysId,
        tags: [...tagsWithTarget(withoutKindTag(initial?.tags ?? []), false), kindTag(kind)],
      };
    }

    return {
      accountId,
      type,
      amount: amountValue,
      date: isoDate,
      categoryId: type === "TRANSFER" ? null : categoryId,
      transferToAccountId: type === "TRANSFER" ? transferToAccountId : null,
      payee: payee.trim() || null,
      notes: notes.trim() || null,
      refundsId: type === "INCOME" || type === "EXPENSE" ? refundsId : null,
      // An entry turned from Lend/Borrow into something else stops being a loan.
      tags: tagsWithTarget(withoutKindTag(initial?.tags ?? []), familyTransfer && filedByPayee),
      ...(initial ? { dueDate: null, repaysId: null } : {}),
    };
  }

  /** The person this entry is with, creating them first when they were typed in as new. */
  async function resolvePersonId(): Promise<string | null> {
    if (!addingPerson) return person?.id ?? null;
    if (!createdPerson.current || createdPerson.current.name !== personName) {
      const res = await api.post<Account>(`/families/${familyId}/accounts`, {
        name: personName,
        type: "PERSON",
        isCommon: sharePerson,
        currency: family.currency,
        openingBalance: 0,
      });
      createdPerson.current = res.data;
    }
    return createdPerson.current.id;
  }

  async function handleSave(andAddAnother: boolean) {
    setError(null);
    if (!validateDates()) return;

    setIsSubmitting(true);
    try {
      const payload = buildPayload(isLending ? await resolvePersonId() : null);
      if (isEdit && initial) {
        const res = await api.patch<Transaction>(`/families/${familyId}/transactions/${initial.id}`, payload);
        savedTransaction.current = res.data;
      } else if (!savedTransaction.current) {
        const res = await api.post<Transaction>(`/families/${familyId}/transactions`, payload);
        savedTransaction.current = res.data;
      }
      const saved = savedTransaction.current!;
      if (rememberPayee && canRemember) {
        try {
          await savePayeeRule();
          setRememberPayee(false);
        } catch (err) {
          throw new ClientError(`Saved, but couldn't remember the payee: ${getErrorMessage(err, "try again")}`);
        }
      }
      if (canRepeat && repeat) {
        try {
          await api.post(`/families/${familyId}/recurring`, {
            type,
            amount: amountValue,
            accountId,
            categoryId,
            payee: payee.trim() || null,
            notes: notes.trim() || null,
            frequency: repeat,
            startDate: date.trim(),
            firstTransactionId: saved.id,
          });
        } catch (err) {
          throw new ClientError(`Saved, but couldn't make it repeat: ${getErrorMessage(err, "try again")}`);
        }
      }
      savedTransaction.current = null;
      // Saved, but it won't show in totals until an admin approves it.
      if (saved.approvalStatus === "PENDING") toast("Saved and sent to an admin for approval");
      onSaved(saved);
      // A transfer with a person (or a person's "paid for something") moves their balance.
      if (isLending || paidByPerson || type === "TRANSFER") await refreshAccounts().catch(() => undefined);

      if (andAddAnother && !isEdit) {
        setAmount("");
        setPayee("");
        setNotes("");
        setDueDate("");
        setRepaysId(null);
        setRefundsId(null);
        setRepeat(null);
        setTargetTouched(false);
        setDate(todayIso());
        if (isLending) {
          // A person just added is now one of the chips, with an up-to-date balance.
          if (createdPerson.current) setPersonId(createdPerson.current.id);
          setAddingPerson(false);
          setNewPersonName("");
          createdPerson.current = null;
        }
        setIsSubmitting(false);
      } else {
        onClose();
      }
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update transaction" : "Unable to create transaction"));
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    setError(null);
    setIsDeleting(true);
    try {
      await api.delete(`/families/${familyId}/transactions/${initial.id}`);
      toast("Moved to the bin");
      onSaved(initial);
      await refreshAccounts().catch(() => undefined);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete transaction"));
      setConfirmDelete(false);
      setIsDeleting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit && !isSubmitting) handleSave(false);
  }

  const typeTone =
    type === "INCOME" || (isLending && !moneyGoesOut(kind)) ? "text-income" : type === "EXPENSE" || isLending ? "text-expense" : "text-brand-600";

  const categoryHint = isLending
    ? "Optional — what it was for."
    : familyTransfer
      ? "Optional for a family transfer."
      : payeeMatch && !targetTouched
        ? payeeMatch.source === "rule"
          ? `Filled in by your payee rule “${payeeMatch.rule!.payee}”.`
          : "Filled in from how this payee was filed before."
        : undefined;

  return (
    <Modal
      title={isEdit ? "Edit transaction" : "Add transaction"}
      onClose={onClose}
      size="xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!isEdit && (
            <Button type="button" variant="secondary" disabled={isSubmitting || !canSubmit} onClick={() => handleSave(true)}>
              Save &amp; add another
            </Button>
          )}
          <Button type="submit" form="transaction-form" loading={isSubmitting} disabled={!canSubmit}>
            {isEdit ? "Save changes" : "Save"}
          </Button>
        </div>
      }
    >
      <form id="transaction-form" onSubmit={handleSubmit} className="space-y-5">
        <Segmented
          value={type}
          onChange={handleSelectType}
          options={TYPE_OPTIONS}
          className="w-full text-xs sm:text-sm [&>button]:flex-1 [&>button]:!px-1.5 sm:[&>button]:!px-3"
        />

        {/* Two columns on a wide screen: what moved and where on the left, how it's filed on the right. */}
        <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-5">

        {canBeLoanReturn && (
          <div className="space-y-2 rounded-2xl bg-surface-sunken/70 p-3">
            <p className="text-xs text-ink-muted">
              {type === "INCOME" ? "Money from a person, not income? Record it as:" : "Money to a person, not spending? Record it as:"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip selected={familyTransfer} onClick={toggleFamilyTransfer}>
                <Home size={13} />
                {type === "INCOME" ? "From family" : "To family"}
              </Chip>
              {(type === "INCOME" ? (["got-back", "borrowed"] as const) : (["lent", "paid-back"] as const)).map((k) => (
                <Chip key={k} onClick={() => recordAsLending(k)}>
                  <ArrowRight size={13} />
                  {LENDING_KINDS.find((x) => x.value === k)!.label}
                </Chip>
              ))}
            </div>
            {familyTransfer && (
              <p className="text-xs text-ink-subtle">
                {type === "INCOME"
                  ? "Family transfer: added to the account's balance, but not counted as income — and nobody owes it back."
                  : "Family transfer: taken from the account's balance, but not counted as spending or in budgets — and nobody owes it back."}
              </p>
            )}
          </div>
        )}

        {isLending && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {LENDING_KINDS.map((k) => (
                <Chip
                  key={k.value}
                  selected={kind === k.value}
                  onClick={() => {
                    setKind(k.value);
                    setRepaysId(null);
                  }}
                >
                  {k.label}
                </Chip>
              ))}
            </div>
            <p className="text-xs text-ink-subtle">{LENDING_KINDS.find((k) => k.value === kind)?.hint}. Never counted as income or an expense.</p>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-surface-sunken/60 px-4 py-5 text-center">
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Amount</p>
          <div className={cn("flex items-center justify-center gap-1.5 text-4xl font-extrabold tracking-tight", typeTone)}>
            <span className="text-2xl opacity-70">{symbol}</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              autoFocus={!isEdit}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              aria-label="Amount"
              className="w-40 bg-transparent text-center tabular-nums outline-none placeholder:text-ink-subtle/50"
            />
          </div>
          {lendingPreview && <p className="mt-1.5 text-sm font-semibold text-ink-muted">After this: {lendingPreview}</p>}
        </div>

        {isLending && (
          <div>
            <Label>{moneyGoesOut(kind) ? "To" : "From"}</Label>
            <div className="flex flex-wrap gap-2">
              {people.map((p) => (
                <Chip
                  key={p.id}
                  selected={!addingPerson && personId === p.id}
                  onClick={() => {
                    setAddingPerson(false);
                    if (p.id !== personId) setRepaysId(null);
                    setPersonId(p.id);
                  }}
                >
                  {p.name}
                </Chip>
              ))}
              {people.length > 0 && (
                <Chip
                  selected={addingPerson}
                  onClick={() => {
                    setAddingPerson(true);
                    setRepaysId(null);
                  }}
                >
                  <Plus size={13} />
                  New person
                </Chip>
              )}
            </div>
            {addingPerson && (
              <div className={cn("space-y-3", people.length > 0 && "mt-3")}>
                <Input value={newPersonName} onChange={(e) => setNewPersonName(e.target.value)} placeholder="Their name" aria-label="Their name" />
                <Toggle checked={sharePerson} onChange={setSharePerson} label="Share with family" description="Off keeps this between you and them." />
              </div>
            )}
          </div>
        )}

        {repaying && openLoans.length > 0 && (
          <div>
            <Label>Pays back</Label>
            <div className="flex flex-wrap gap-2">
              <Chip selected={!linkedLoan} onClick={() => setRepaysId(null)}>
                Oldest loans first
              </Chip>
              {openLoans.map((loan) => (
                <Chip
                  key={loan.transaction!.id}
                  selected={linkedLoan === loan}
                  onClick={() => {
                    setRepaysId(loan.transaction!.id);
                    if (!amount.trim() && loan.remaining > 0) setAmount(String(Number(loan.remaining.toFixed(2))));
                  }}
                >
                  {loanLabel(loan, person!.currency)}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              {linkedLoan && amountValue > linkedLoan.remaining + 0.005
                ? `That's more than is left on this loan; the rest settles older ones with ${person!.name} first.`
                : "Link it to the loan it returns, so you can see exactly what came back."}
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            {(props) => <Input {...props} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          {isLending ? (
            startsLoan(kind) ? (
              <Field label="Return by" hint="Optional">
                {(props) => <Input {...props} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
              </Field>
            ) : (
              <div />
            )
          ) : (
            <Field label="Payee" hint="Optional">
              {(props) => <Input {...props} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Optional" />}
            </Field>
          )}
        </div>

        <div>
          <Label>{isLending ? (moneyGoesOut(kind) ? "Paid from" : "Received into") : "Account"}</Label>
          {sourceAccounts.length === 0 ? (
            <p className="text-sm text-ink-subtle">Add an account first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sourceAccounts.map((a) => (
                <Chip key={a.id} selected={accountId === a.id} onClick={() => handleSelectAccount(a.id)}>
                  {isPerson(a) ? <HandCoins size={12} /> : <Landmark size={12} />}
                  {a.name}
                </Chip>
              ))}
            </div>
          )}
          {paidByPerson && (
            <p className="mt-2 text-xs text-ink-subtle">
              {type === "EXPENSE"
                ? `${paidByPerson.name} paid, so this adds to what you owe them.`
                : `${paidByPerson.name} received it for you, so this adds to what they owe you.`}
            </p>
          )}
        </div>

        {type === "TRANSFER" && (
          <div>
            <Label>Transfer to</Label>
            {transferTargets.length === 0 ? (
              <p className="text-sm text-ink-subtle">Add another account to transfer to.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {transferTargets.map((a) => (
                  <Chip key={a.id} selected={transferToAccountId === a.id} onClick={() => setTransferToAccountId(a.id)}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        <div className="min-w-0 space-y-5">
        {refundable && !paidByPerson && (refundOptions.length > 0 || refundsId) && (
          <Field
            label={refundable === "INCOME" ? "Refund of" : "Return of"}
            hint={
              refundsId
                ? refundable === "INCOME"
                  ? "Money back for that expense: it comes off what the expense counts for, and isn't counted as income."
                  : "Money handed back out of that income: it comes off the income, and isn't counted as spending."
                : refundable === "INCOME"
                  ? "Money back for something you paid — a cancelled order, a reversed verification charge? Pick the expense."
                  : "Handing back money you received — a wrong transfer, a deposit? Pick the income."
            }
          >
            {(props) => (
              <SearchSelect
                {...props}
                options={refundOptions}
                value={refundsId}
                onChange={(id) => {
                  setRefundsId(id);
                  const original = id ? refundCandidates?.rows.find((t) => t.id === id) : undefined;
                  const left = original ? refundableLeft(original, initial) : 0;
                  if (left > 0 && (!amount.trim() || amountValue > left)) setAmount(String(Number(left.toFixed(2))));
                }}
                placeholder={refundable === "INCOME" ? "Not a refund" : "Not a return"}
                clearLabel={refundable === "INCOME" ? "Not a refund" : "Not a return"}
                searchPlaceholder="Search by payee, amount or category"
                emptyText="No matching entries."
              />
            )}
          </Field>
        )}

        {type !== "TRANSFER" && (
          <>
            {wantsBudgets && budgetChoices.length > 0 && (
              <div>
                <Label>Counts in budget</Label>
                <div className="flex flex-wrap gap-2">
                  {budgetChoices.map((b) => (
                    <Chip
                      key={b.id}
                      color={overBudget && countsIn.includes(b) ? "rgb(var(--c-expense))" : b.category.color}
                      selected={countsIn.includes(b)}
                      onClick={() => {
                        setAddingCategory(false);
                        pickCategory(countsIn.includes(b) ? null : b.categoryId);
                      }}
                    >
                      {`${budgetName(b)}${b.period === "ANNUAL" ? " · yearly" : ""}${b.ownerId ? "" : " · Family"}`}
                    </Chip>
                  ))}
                </div>
                <div className={cn("mt-1.5 space-y-0.5 text-xs", overBudget ? "text-expense" : "text-ink-subtle")}>
                  {countsIn.length > 0 ? budgetHints.map((h) => <p key={h}>{h}</p>) : <p>Pick the budget this comes out of, or a category below.</p>}
                </div>
              </div>
            )}
            <Field label="Category" hint={categoryHint}>
              {(props) => (
                <>
                  <CategoryPicker
                    {...props}
                    categories={categoriesForType}
                    selectedId={categoryId}
                    onSelect={pickCategory}
                    clearLabel="No category"
                    onAddNew={family.role !== "VIEWER" && !addingCategory ? () => setAddingCategory(true) : undefined}
                  />
                  {addingCategory && (
                    <NewCategoryForm
                      familyId={familyId}
                      type={newCategoryType}
                      taken={categories}
                      onCreated={(created) => {
                        setCreatedCategories((list) => [...list, created]);
                        pickCategory(created.id);
                        setAddingCategory(false);
                        refreshCategories().catch(() => undefined);
                      }}
                      onCancel={() => setAddingCategory(false)}
                    />
                  )}
                </>
              )}
            </Field>
          </>
        )}

        {canRemember && (
          <div className="rounded-2xl bg-surface-sunken/70 p-3">
            <Toggle
              checked={rememberPayee}
              onChange={setRememberPayee}
              label="Remember for this payee"
              description={`${sameRule ? "Change the rule: " : "Always file "}“${rememberPattern}” ${type === "INCOME" ? "income" : "expenses"} as ${rememberTarget}, from SMS too.`}
            />
          </div>
        )}

        {canRepeat && (
          <div>
            <Label>Repeat</Label>
            <div className="flex flex-wrap gap-2">
              <Chip selected={!repeat} onClick={() => setRepeat(null)}>
                Doesn't repeat
              </Chip>
              {FREQUENCIES.map((f) => (
                <Chip key={f.value} selected={repeat === f.value} onClick={() => setRepeat(f.value)}>
                  <Repeat size={12} />
                  {f.label}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-subtle">
              {repeat && parseDay(date)
                ? `${describeSchedule({ frequency: repeat, startDate: date.trim() })}, recorded automatically${
                    type === "EXPENSE" ? ` and counted in your ${repeat === "YEARLY" ? "yearly" : "monthly"} budget` : ""
                  }.`
                : "For a salary, rent, a home maker's pay or a subscription."}
            </p>
          </div>
        )}

        {isEdit && initial?.recurringId && (
          <div className="flex items-center gap-2.5 rounded-2xl bg-surface-sunken/70 p-3 text-xs text-ink-muted">
            <Repeat size={15} className="shrink-0" />
            <span className="flex-1">Recorded from a repeating payment. Changes here affect only this one.</span>
            <button
              type="button"
              className="font-semibold text-brand-600 hover:underline"
              onClick={() => {
                onClose();
                navigate("/recurring");
              }}
            >
              Manage
            </button>
          </div>
        )}

        <Field label="Notes" hint="Optional">
          {(props) => <Input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={isLending ? "What for?" : "Add a note"} />}
        </Field>

        <ErrorText>{error}</ErrorText>

        {canDelete &&
          (confirmDelete ? (
            <div className="space-y-3 rounded-2xl bg-expense-soft p-4">
              <p className="text-sm font-medium text-ink">Delete this transaction? It moves to the bin and is removed from balances and reports.</p>
              <div className="flex gap-2">
                <Button type="button" variant="danger" size="sm" loading={isDeleting} onClick={handleDelete}>
                  Delete
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={isDeleting} onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" size="sm" icon={<Trash2 size={15} />} disabled={isSubmitting} onClick={() => setConfirmDelete(true)} className="text-expense hover:text-expense">
              Delete transaction
            </Button>
          ))}
        </div>
        </div>
      </form>
    </Modal>
  );
}
