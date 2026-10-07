import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowRight, Ban, Home, Plus, Repeat, Trash2, Undo2, Users } from "lucide-react-native";
import { api } from "../../src/api/client";
import { fetchWithCache } from "../../src/lib/cache";
import type { Account, Budget, Category, PayeeRule, RecurringFrequency, Transaction, TransactionType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { ClientError, getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Segmented, SkeletonRows, Toggle, FormScrollView } from "../../src/components/ui";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { RefundsPicker } from "../../src/components/RefundsPicker";
import { NewCategoryForm } from "../../src/components/NewCategoryForm";
import { DateField, TimeField } from "../../src/components/DateTimeField";
import { currencySymbol, formatCurrency } from "../../src/lib/format";
import { MONTH_LABELS, combineDateTime, localDateInput, localTimeInput } from "../../src/lib/dateUtils";
import { href } from "../../src/lib/nav";
import {
  LENDING_KINDS,
  WRITE_OFF_TAG,
  balanceEffect,
  describeBalance,
  describeEntry,
  entryLabel,
  isPerson,
  isWriteOff,
  kindOf,
  kindTag,
  loanLabel,
  moneyGoesOut,
  parseKind,
  repaidDirection,
  startsLoan,
  trackLoans,
  withoutKindTag,
  writeOffPayload,
  type LendingKind,
} from "../../src/lib/lending";
import { refreshTodayWidget } from "../../src/lib/todayWidget";
import { syncTransactions, useTransactions } from "../../src/lib/transactionStore";
import { FREQUENCIES, describeSchedule } from "../../src/lib/recurring";
import { moveToBackground } from "../../modules/home-widgets";
import { budgetName } from "../../src/lib/budgets";
import { NOT_COUNTED_TAG, isFamilyTransfer, isNotCounted } from "../../src/lib/transactionTotals";
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
} from "../../src/lib/payeeRules";

/** "LENDING" is saved as a transfer between one of your accounts and a person. */
type FormType = TransactionType | "LENDING";

const TYPE_OPTIONS: { value: FormType; label: string }[] = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "LENDING", label: "Lend/Borrow" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** A family member's first name, from the account they share. */
function memberName(account: Account) {
  return account.owner?.name.trim().split(/\s+/)[0] || "Family member";
}

function todayIso() {
  return localDateInput(new Date());
}

function parseType(value: string | undefined): FormType | null {
  return TYPE_OPTIONS.some((o) => o.value === value) ? (value as FormType) : null;
}

/** A YYYY-MM-DD day as local midnight, or null when it isn't a date. */
function parseDay(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Tags without the ones that make an entry uncounted or a write-off — for an entry that stops being one. */
function withoutCountingTags(tags: string[]) {
  return tags.filter((t) => t !== NOT_COUNTED_TAG && t !== WRITE_OFF_TAG);
}

export default function TransactionForm() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const router = useRouter();
  const navigation = useNavigation();
  // `type`, `accountId`, `personId`, `kind`, `amount` and `repaysId` preset a new entry;
  // `source=widget` marks a home-screen quick add.
  const params = useLocalSearchParams<{
    id?: string;
    transaction?: string;
    type?: string;
    accountId?: string;
    personId?: string;
    kind?: string;
    amount?: string;
    repaysId?: string;
    refundsId?: string;
    source?: string;
  }>();

  const initial = useMemo<Transaction | null>(() => {
    if (!params.transaction) return null;
    try {
      return JSON.parse(params.transaction) as Transaction;
    } catch {
      return null;
    }
  }, [params.transaction]);
  const isEdit = !!initial;
  // Only a new quick add can come from a widget. An edit is always opened from inside the app, and
  // must never send the app to the background when it closes.
  const fromWidget = params.source === "widget" && !isEdit;

  // A family member's entry on their own account (or money they sent you): shown, never edited here.
  const readOnly = !!initial?.readOnly;

  useLayoutEffect(() => {
    navigation.setOptions({ title: readOnly ? "Transaction" : isEdit ? "Edit transaction" : "Add transaction" });
  }, [navigation, isEdit, readOnly]);

  // Every account you see; the ones you record on, and those other members share with the family
  // (money can be transferred to them).
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const accounts = useMemo(() => allAccounts.filter((a) => !a.owner || a.owner.id === user!.id), [allAccounts, user]);
  const sharedAccounts = useMemo(() => allAccounts.filter((a) => a.owner && a.owner.id !== user!.id), [allAccounts, user]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchWithCache<Account[]>(`/families/${family.id}/accounts`, { params: { include: "shared" } }, (cached) => {
        if (!cancelled) setAccounts(cached.data);
      }),
      fetchWithCache<Category[]>(`/families/${family.id}/categories`, undefined, (cached) => {
        if (!cancelled) {
          setCategories(cached.data);
          setIsLoading(false);
        }
      }),
    ])
      .then(([accountsRes, categoriesRes]) => {
        if (cancelled) return;
        setAccounts(accountsRes.data);
        setCategories(categoriesRes.data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getErrorMessage(err, "Unable to load form data"));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [family.id]);

  const [type, setType] = useState<FormType>(initial?.type ?? parseType(params.type) ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? params.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  // Money from or to family: moves the balance, but isn't income or spending and isn't owed back.
  const [familyTransfer, setFamilyTransfer] = useState(initial ? isFamilyTransfer(initial) : false);
  // Once the user picks a category (or family transfer) themselves, the payee stops filling it in.
  const [targetTouched, setTargetTouched] = useState(!!initial && (!!initial.categoryId || isFamilyTransfer(initial)));
  const [rememberPayee, setRememberPayee] = useState(false);
  const [transferToAccountId, setTransferToAccountId] = useState<string | null>(initial?.transferToAccountId ?? null);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : params.amount ?? "");
  // Local day and time, not initial.date.slice(0, 10): that is the UTC day, and re-saving it would
  // shift the transaction back a day east of UTC. A new entry starts at the current moment.
  const [date, setDate] = useState(initial ? localDateInput(new Date(initial.date)) : todayIso());
  const [time, setTime] = useState(() => localTimeInput(initial ? new Date(initial.date) : new Date()));
  const [payee, setPayee] = useState(initial?.payee ?? "");
  // A write-off, or an entry kept out of totals, can be switched to count (or back).
  const [counted, setCounted] = useState(initial ? !isNotCounted(initial) : true);
  // Lent money that won't come back: saved as the loan plus a write-off that closes it.
  const [notReturning, setNotReturning] = useState(false);
  const [notReturningCounted, setNotReturningCounted] = useState(false);
  // How much of the loan being edited was written off (it drops to 0 once the write-off is cancelled).
  const [writtenOff, setWrittenOff] = useState(initial?.writtenOffAmount ?? 0);
  const [isCancellingWriteOff, setIsCancellingWriteOff] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const canDelete = isEdit && family.role !== "VIEWER" && !readOnly;

  // Lend & borrow: `accountId` is always your own account; the person is the other end.
  const [kind, setKind] = useState<LendingKind>(parseKind(params.kind) ?? "lent");
  const [personId, setPersonId] = useState<string | null>(params.personId ?? null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState("");
  const [sharePerson, setSharePerson] = useState(false);
  const [dueDate, setDueDate] = useState(initial?.dueDate ? localDateInput(new Date(initial.dueDate)) : "");
  // A return pays back this lend/borrow entry first; null matches it to the oldest open loans.
  const [repaysId, setRepaysId] = useState<string | null>(initial?.repaysId ?? params.repaysId ?? null);
  const [refundsId, setRefundsId] = useState<string | null>(initial?.refundsId ?? params.refundsId ?? null);
  const [addingCategory, setAddingCategory] = useState(false);
  // A person created by a save whose transaction then failed — reused on retry, never created twice.
  const createdPerson = useRef<Account | null>(null);
  // "Repeat" on a new income or expense: this transaction becomes the first of a repeating payment.
  const [repeat, setRepeat] = useState<RecurringFrequency | null>(null);
  // Saved on an attempt whose repeating schedule then failed; a retry only creates the schedule.
  const savedTransactionId = useRef<string | null>(null);
  // Likewise for the write-off that follows a loan marked as not coming back.
  const savedWriteOff = useRef(false);
  const didInitFromAccounts = useRef(false);

  // Once accounts are known: a transfer with a person opens as Lend/Borrow, and a new entry starts
  // on a real account, never on a person.
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
    if (!initial && parseType(params.type) === "LENDING" && people.length === 0) setAddingPerson(true);
  }, [accounts, initial, params.type]);

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
  // Sending money to a family member: into an account they share with the family. It's a transfer —
  // not spending for you, not income for them.
  const memberTargets = sharedAccounts.filter((a) => a.id !== accountId && !isPerson(a));
  const toMember = memberTargets.find((a) => a.id === transferToAccountId) ?? null;
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const paidByPerson = selectedAccount && isPerson(selectedAccount) && !isLending && type !== "TRANSFER" ? selectedAccount : null;
  // A write-off stays one while it's the same kind of entry on the same person.
  const editingWriteOff = !!initial && isWriteOff(initial) && type === initial.type && accountId === initial.accountId;
  // Entries kept out of totals (a write-off, money moved off a member who left) can be counted again.
  const showCounted = !!initial && (type === "INCOME" || type === "EXPENSE") && (editingWriteOff || isNotCounted(initial));
  // The loan being edited, while it's still money lent: it can be written off, or its write-off taken back.
  const editingLoan = isEdit && isLending && kind === "lent" && initial?.type === "TRANSFER" && !readOnly;
  // A salary, rent or subscription can be set to repeat as it's added (not from a person's account).
  const canRepeat = !isEdit && (type === "INCOME" || type === "EXPENSE") && !paidByPerson;
  const symbol = currencySymbol(selectedAccount?.currency ?? family.currency);

  const person = isLending && !addingPerson ? people.find((p) => p.id === personId) ?? null : null;
  const personName = addingPerson ? newPersonName.trim() : person?.name ?? "";
  const hasPerson = addingPerson ? personName.length > 0 : !!person;

  // A return can say which loan it pays back. This entry's own earlier save is left out, so the
  // loans read as they stood before it.
  const repaying = isLending && person ? repaidDirection(kind) : null;
  // A return lists the open loans; an edited loan needs to know how much of it came back already.
  const personLoanId = repaying || (editingLoan && person) ? person!.id : null;
  const personLoanFilter = useMemo(() => (personLoanId ? { accountId: personLoanId } : null), [personLoanId]);
  const { transactions: personHistory } = useTransactions(user!.id, family.id, personLoanFilter);
  const openLoans = useMemo(() => {
    if (!repaying || !person) return [];
    const history = personHistory.filter((t) => t.id !== initial?.id && (t.accountId === person.id || t.transferToAccountId === person.id));
    return trackLoans(history, person).filter((l) => l.transaction && l.direction === repaying && (!l.settled || l.transaction.id === repaysId));
  }, [repaying, person, personHistory, initial?.id, repaysId]);
  const linkedLoan = openLoans.find((l) => l.transaction!.id === repaysId) ?? null;

  // What of the edited loan has come back already; writing it off covers only the rest.
  const returnedOnLoan = useMemo(() => {
    if (!editingLoan || !person || !initial) return 0;
    const history = personHistory.filter((t) => t.accountId === person.id || t.transferToAccountId === person.id);
    return trackLoans(history, person).find((l) => l.transaction?.id === initial.id)?.returned ?? 0;
  }, [editingLoan, person, personHistory, initial]);
  const typedAmount = Number(amount);
  const leftToWriteOff = Math.max(0, (typedAmount > 0 ? typedAmount : 0) - returnedOnLoan);
  // Lent money that won't come back is recorded with its write-off: as it's added, or later on the loan
  // itself (once per loan — a written-off one can have it cancelled instead).
  const canMarkNotReturning = isLending && kind === "lent" && !readOnly && (!isEdit || (editingLoan && writtenOff < 0.005 && leftToWriteOff > 0.005));
  const showWrittenOff = editingLoan && writtenOff > 0.005;
  
  // A refund (income) gives back an expense; a return (expense) gives back an income.
  const refundable = type === "INCOME" || type === "EXPENSE" ? type : null;
  const refundFilter = useMemo(
    () => (refundable ? { type: refundable === "INCOME" ? ("EXPENSE" as const) : ("INCOME" as const) } : null),
    [refundable]
  );
  const { transactions: refundCandidates } = useTransactions(user!.id, family.id, refundFilter);

  // New categories are income or expense; for Lend/Borrow, by which way the money went.
  const newCategoryType = isLending ? (moneyGoesOut(kind) ? "EXPENSE" : "INCOME") : type === "INCOME" ? "INCOME" : "EXPENSE";

  // Payee → category: the family's payee rules, then how this payee was filed before.
  const [payeeRules, setPayeeRules] = useState<PayeeRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    const show = (rules: PayeeRule[]) => !cancelled && setPayeeRules(rules);
    fetchPayeeRules(family.id, show).then(show, () => undefined);
    return () => {
      cancelled = true;
    };
  }, [family.id]);
  const historyFilter = useMemo(() => ({ from: new Date(Date.now() - 365 * DAY_MS) }), []);
  const { transactions: history } = useTransactions(user!.id, family.id, historyFilter);
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
    !readOnly &&
    rememberPattern.length >= 2 &&
    (!!categoryId || familyTransfer) &&
    !(existingRule && existingRule.categoryId === categoryId && existingRule.familyTransfer === familyTransfer);
  // The same pattern saved before is changed rather than doubled.
  const sameRule = existingRule && normalizePayee(existingRule.payee) === rememberPattern ? existingRule : null;
  const rememberTarget = describeTarget({ category: categories.find((c) => c.id === categoryId) ?? null, familyTransfer });

  async function savePayeeRule() {
    const input = { payee: rememberPattern, type: type as "INCOME" | "EXPENSE", categoryId, familyTransfer };
    const saved = sameRule ? await updatePayeeRule(family.id, sameRule.id, input) : await createPayeeRule(family.id, input);
    setPayeeRules((list) => [...list.filter((r) => r.id !== saved.id), saved]);
  }

  const amountValue = Number(amount);
  // The moment the entry is dated, from its day and time of day.
  const when = combineDateTime(date, time);
  const canSubmit =
    !!accountId &&
    amount.trim().length > 0 &&
    amountValue > 0 &&
    !!when &&
    (type !== "TRANSFER" || (!!transferToAccountId && transferToAccountId !== accountId)) &&
    (!isLending || (hasPerson && !!selectedAccount && !isPerson(selectedAccount)));

  // Where the person stands after this entry. An edited entry is already in their balance, so take
  // it out first.
  const lendingPreview = (() => {
    if (!isLending || !hasPerson || !(amountValue > 0)) return null;
    let before = person?.balance ?? 0;
    if (person && initial?.type === "TRANSFER" && (initial.accountId === person.id || initial.transferToAccountId === person.id)) {
      before -= describeEntry(initial, person.id).effect;
    }
    // Money that won't come back is written off straight away, so they don't owe it.
    const effect = balanceEffect(kind, amountValue) - (canMarkNotReturning && notReturning ? leftToWriteOff : 0);
    return describeBalance(personName, before + effect, person?.currency ?? family.currency);
  })();

  // The budgets an expense counts in: those for its date's month, and the yearly ones.
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const dateDay = when;
  const budgetYear = dateDay?.getFullYear();
  const budgetMonth = dateDay ? dateDay.getMonth() + 1 : undefined;
  // Money sent to family isn't spending, so it doesn't come out of a budget; nor does an uncounted entry.
  const wantsBudgets = type === "EXPENSE" && !familyTransfer && (!showCounted || counted);
  useEffect(() => {
    if (!wantsBudgets || !budgetYear || !budgetMonth) return;
    let cancelled = false;
    const url = `/families/${family.id}/budgets`;
    Promise.all([
      fetchWithCache<Budget[]>(url, { params: { year: budgetYear, month: budgetMonth, tzOffset: new Date().getTimezoneOffset() } }, (cached) => {
        if (!cancelled) setBudgets((prev) => [...cached.data, ...prev.filter(b => b.period === "ANNUAL")]); // A bit rough but we'll just let the then block overwrite it completely.
      }),
      fetchWithCache<Budget[]>(url, { params: { year: budgetYear, period: "ANNUAL", tzOffset: new Date().getTimezoneOffset() } }, (cached) => {
        if (!cancelled) setBudgets((prev) => [...prev.filter(b => b.period === "MONTHLY"), ...cached.data]);
      }),
    ])
      .then(([monthRes, yearRes]) => {
        if (!cancelled) setBudgets([...monthRes.data, ...yearRes.data]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [family.id, wantsBudgets, budgetYear, budgetMonth]);

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
  const budgetHint = countsIn
    .map((b) => {
      const left = leftAfter(b);
      const when = b.period === "ANNUAL" ? `in ${b.year}` : `in ${MONTH_LABELS[(b.month ?? 1) - 1]}`;
      return left >= 0 ? `${budgetName(b)} ${when}: ${formatCurrency(left, family.currency)} left after this` : `Takes ${budgetName(b)} over by ${formatCurrency(-left, family.currency)} ${when}`;
    })
    .join("\n");
  const overBudget = countsIn.some((b) => leftAfter(b) < 0);

  /**
   * Money someone returned, or money you're returning, recorded as plain income or an expense: turn it
   * into a Lend/Borrow return so it settles the loan instead of counting as income or spending.
   */
  const canBeLoanReturn = (type === "INCOME" || type === "EXPENSE") && !paidByPerson && !initial?.recurringId && !readOnly;
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

  /** Checks the picked dates before anything is saved (or a new person created). */
  function validateDates() {
    if (!when) {
      setError("Pick the date and time");
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
    const isoDate = when!.toISOString();
    const payloadRepaysId = repaying ? repaysId : null;

    if (isLending) {
      // Money that won't come back has nothing to be returned by.
      const due = startsLoan(kind) && dueDate.trim() && !(canMarkNotReturning && notReturning) ? parseDay(dueDate)!.toISOString() : null;
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
        tags: [...tagsWithTarget(withoutKindTag(withoutCountingTags(initial?.tags ?? [])), false), kindTag(kind)],
      };
    }

    // An entry turned from Lend/Borrow into something else stops being a loan, and one moved off a
    // person (or turned into a transfer) stops being a write-off.
    let tags = tagsWithTarget(withoutKindTag(initial?.tags ?? []), familyTransfer && filedByPayee);
    if (type === "TRANSFER") tags = withoutCountingTags(tags);
    else if (!editingWriteOff) tags = tags.filter((t) => t !== WRITE_OFF_TAG);
    if (showCounted) tags = [...tags.filter((t) => t !== NOT_COUNTED_TAG), ...(counted ? [] : [NOT_COUNTED_TAG])];

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
      tags,
      // A write-off keeps the loan it closes.
      ...(initial ? { dueDate: null, repaysId: editingWriteOff ? initial.repaysId : null } : {}),
    };
  }

  /** The person this entry is with, creating them first when they were typed in as new. */
  async function resolvePersonId(): Promise<string | null> {
    if (!addingPerson) return person?.id ?? null;
    if (!createdPerson.current || createdPerson.current.name !== personName) {
      const res = await api.post<Account>(`/families/${family.id}/accounts`, {
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
      const personAccountId = isLending ? await resolvePersonId() : null;
      const payload = buildPayload(personAccountId);
      if (isEdit && initial) {
        await api.patch(`/families/${family.id}/transactions/${initial.id}`, payload);
        savedTransactionId.current = initial.id;
      } else if (!savedTransactionId.current) {
        const res = await api.post<Transaction>(`/families/${family.id}/transactions`, payload);
        savedTransactionId.current = res.data.id;
      }
      if (canMarkNotReturning && notReturning && personAccountId && savedTransactionId.current && !savedWriteOff.current) {
        try {
          // Counted as spending, it's filed under the loan's category when that's an expense one.
          const spendingCategory = categories.find((c) => c.id === categoryId && c.type === "EXPENSE")?.id ?? null;
          await api.post(
            `/families/${family.id}/transactions`,
            writeOffPayload({
              person: { id: personAccountId, name: personName },
              loan: { direction: "lent", transaction: { id: savedTransactionId.current } },
              // A loan written off later covers only what hasn't come back.
              amount: leftToWriteOff,
              date: when!.toISOString(),
              counted: notReturningCounted,
              categoryId: spendingCategory,
              notes: null,
            })
          );
          savedWriteOff.current = true;
        } catch (err) {
          throw new ClientError(`Saved the loan, but couldn't mark it as not coming back: ${getErrorMessage(err, "try again")}`);
        }
      }
      if (rememberPayee && canRemember) {
        try {
          await savePayeeRule();
          setRememberPayee(false);
        } catch (err) {
          throw new ClientError(`Saved, but couldn't remember the payee: ${getErrorMessage(err, "try again")}`);
        }
      }
      if (canRepeat && repeat && savedTransactionId.current) {
        try {
          await api.post(`/families/${family.id}/recurring`, {
            type,
            amount: amountValue,
            accountId,
            categoryId,
            payee: payee.trim() || null,
            notes: notes.trim() || null,
            frequency: repeat,
            startDate: date.trim(),
            firstTransactionId: savedTransactionId.current,
          });
        } catch (err) {
          throw new ClientError(`Saved, but couldn't make it repeat: ${getErrorMessage(err, "try again")}`);
        }
      }
      savedTransactionId.current = null;
      savedWriteOff.current = false;
      refreshTodayWidget(family.id, family.currency);
      if (andAddAnother && !isEdit) {
        setAmount("");
        setPayee("");
        setNotes("");
        setDueDate("");
        setRepaysId(null);
        setRefundsId(null);
        setRepeat(null);
        setNotReturning(false);
        setNotReturningCounted(false);
        setDate(todayIso());
        setTime(localTimeInput(new Date()));
        if (isLending) {
          // A person just added is now one of the chips, with an up-to-date balance.
          const res = await api.get<Account[]>(`/families/${family.id}/accounts`, { params: { include: "shared" } });
          setAccounts(res.data);
          if (createdPerson.current) setPersonId(createdPerson.current.id);
          setAddingPerson(false);
          setNewPersonName("");
          createdPerson.current = null;
        }
        setIsSubmitting(false);
      } else {
        // Stays "submitting" on the way out: re-enabling the buttons while the screen closes only
        // re-renders a screen that is being torn down.
        close();
      }
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update transaction" : "Unable to create transaction"));
      setIsSubmitting(false);
    }
  }

  /** Takes the loan's write-off back: the money counts as owed again. */
  async function handleCancelWriteOff() {
    if (!initial) return;
    setError(null);
    setIsCancellingWriteOff(true);
    try {
      await api.post(`/families/${family.id}/transactions/${initial.id}/cancel-write-off`);
      setWrittenOff(0);
      // The loan's mark and the write-offs gone to the bin reach the local copy.
      syncTransactions(user!.id, family.id, { force: true }).catch(() => undefined);
      refreshTodayWidget(family.id, family.currency);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to cancel the write-off"));
    } finally {
      setIsCancellingWriteOff(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    setError(null);
    setIsDeleting(true);
    try {
      await api.delete(`/families/${family.id}/transactions/${initial.id}`);
      refreshTodayWidget(family.id, family.currency);
      close();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete transaction"));
      setConfirmDelete(false);
      setIsDeleting(false);
    }
  }

  /**
   * Opened from inside the app, this just returns to the previous screen. Opened from a home-screen
   * widget, the user came to add one thing, so after saving the app goes back to the background.
   */
  function close() {
    // A widget can cold-start the app straight into this form, leaving nothing to go back to.
    if (router.canGoBack()) router.back();
    else router.replace(href("/"));
    if (fromWidget) moveToBackground().catch(() => undefined);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={5} />
      </View>
    );
  }

  const typeTone =
    type === "INCOME" || (isLending && !moneyGoesOut(kind)) ? colors.income : type === "EXPENSE" || isLending ? colors.expense : colors.brand600;

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FormScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 64 }}>
        <ErrorText>{loadError}</ErrorText>

        {readOnly && initial && (
          <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <Users size={16} color={colors.inkMuted} />
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.inkMuted }}>
              {(initial.type === "TRANSFER"
                ? initial.account.name + " → " + (initial.transferToAccount?.name ?? "another account") + ". "
                : "On " + initial.account.name + ". ") + "Recorded by a family member on their account, so only they can change it."}
            </Text>
          </View>
        )}

        {/* Someone else's entry: everything shows, nothing can be changed. */}
        <View pointerEvents={readOnly ? "none" : "auto"} style={{ gap: 18 }}>
        <Segmented fullWidth value={type} onChange={handleSelectType} options={TYPE_OPTIONS} />

        {canBeLoanReturn && (
          <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <Text style={{ fontSize: 12.5, color: colors.inkMuted }}>
              {type === "INCOME" ? "Money from a person, not income? Record it as:" : "Money to a person, not spending? Record it as:"}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip
                label={type === "INCOME" ? "From family" : "To family"}
                icon={<Home size={13} color={familyTransfer ? colors.white : colors.brand600} />}
                selected={familyTransfer}
                onPress={toggleFamilyTransfer}
              />
              {(type === "INCOME" ? (["got-back", "borrowed"] as const) : (["lent", "paid-back"] as const)).map((k) => (
                <Chip
                  key={k}
                  label={LENDING_KINDS.find((x) => x.value === k)!.label}
                  icon={<ArrowRight size={13} color={colors.brand600} />}
                  onPress={() => recordAsLending(k)}
                />
              ))}
            </View>
            {familyTransfer && (
              <Text style={{ fontSize: 12, color: colors.inkSubtle }}>
                {type === "INCOME"
                  ? "Family transfer: added to the account's balance, but not counted as income — and nobody owes it back."
                  : "Family transfer: taken from the account's balance, but not counted as spending or in budgets — and nobody owes it back."}
              </Text>
            )}
          </View>
        )}

        {isLending && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {LENDING_KINDS.map((k) => (
                <Chip
                  key={k.value}
                  label={k.label}
                  selected={kind === k.value}
                  onPress={() => {
                    setKind(k.value);
                    setRepaysId(null);
                  }}
                />
              ))}
            </View>
            <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
              {`${LENDING_KINDS.find((k) => k.value === kind)?.hint}. ${
                moneyGoesOut(kind) ? "Taken from" : "Added to"
              } your account's balance — never counted as income or spending.`}
            </Text>
          </View>
        )}

        <View style={{ alignItems: "center", backgroundColor: colors.surfaceSunken, borderRadius: 20, paddingVertical: 22 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase", letterSpacing: 0.4 }}>Amount</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
            <Text style={{ fontSize: 22, color: typeTone, opacity: 0.7 }}>{symbol}</Text>
            <Input
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              style={{
                borderWidth: 0,
                backgroundColor: "transparent",
                // Android pads TextInput vertically and adds font padding, which clipped the top of
                // 34pt digits in the old 48pt box — give the glyphs the full height instead.
                height: 60,
                paddingVertical: 0,
                includeFontPadding: false,
                textAlignVertical: "center",
                fontSize: 34,
                fontWeight: "800",
                color: typeTone,
                textAlign: "center",
                minWidth: 140,
              }}
            />
          </View>
          {lendingPreview && <Text style={{ marginTop: 6, fontSize: 13, fontWeight: "600", color: colors.inkMuted }}>{`After this: ${lendingPreview}`}</Text>}
        </View>

        {isLending && (
          <Field label={moneyGoesOut(kind) ? "To" : "From"}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {people.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  selected={!addingPerson && personId === p.id}
                  onPress={() => {
                    setAddingPerson(false);
                    if (p.id !== personId) setRepaysId(null);
                    setPersonId(p.id);
                  }}
                />
              ))}
              {people.length > 0 && (
                <Chip
                  label="New person"
                  icon={<Plus size={13} color={addingPerson ? colors.white : colors.inkMuted} />}
                  selected={addingPerson}
                  onPress={() => {
                    setAddingPerson(true);
                    setRepaysId(null);
                  }}
                />
              )}
            </View>
            {addingPerson && (
              <View style={{ gap: 12, marginTop: people.length > 0 ? 12 : 0 }}>
                <Input value={newPersonName} onChangeText={setNewPersonName} placeholder="Their name" autoCapitalize="words" />
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Share with family</Text>
                    <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>Off keeps this between you and them.</Text>
                  </View>
                  <Toggle value={sharePerson} onChange={setSharePerson} />
                </View>
              </View>
            )}
          </Field>
        )}

        {showWrittenOff && (
          <View style={{ gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ban size={15} color={colors.inkSubtle} />
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>
                {`${formatCurrency(writtenOff, selectedAccount?.currency ?? family.currency)} written off`}
              </Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.inkSubtle }}>
              {`Won't be returned, so it's left out of what ${personName || "they"} owe${personName ? "s" : ""} you. Recorded as a separate write-off entry; cancel it to count it as owed again.`}
            </Text>
            <Button
              title="Cancel write-off"
              variant="secondary"
              size="sm"
              icon={<Undo2 size={14} color={colors.ink} />}
              loading={isCancellingWriteOff}
              disabled={isSubmitting}
              onPress={handleCancelWriteOff}
            />
          </View>
        )}

        {canMarkNotReturning && (
          <View style={{ gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Won't be returned</Text>
                <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
                  {notReturning
                    ? isEdit
                      ? `Writes off ${formatCurrency(leftToWriteOff, selectedAccount?.currency ?? family.currency)}${returnedOnLoan > 0.005 ? " still owed" : ""}: ${personName || "they"} won't owe it. Saved as a write-off entry linked to this loan; you can cancel it later.`
                      : `Given for good: ${personName || "they"} won't owe it. It still leaves your account.`
                    : "For money you don't expect back. You can also write off a loan later from their page."}
                </Text>
              </View>
              <Toggle value={notReturning} onChange={setNotReturning} />
            </View>
            {notReturning && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Count it as spending</Text>
                  <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
                    {notReturningCounted ? "Counted as an expense, in the category below if it's an expense one." : "Kept out of spending and budgets."}
                  </Text>
                </View>
                <Toggle value={notReturningCounted} onChange={setNotReturningCounted} />
              </View>
            )}
          </View>
        )}

        {repaying && openLoans.length > 0 && (
          <Field
            label="Pays back"
            hint={
              linkedLoan && amountValue > linkedLoan.remaining + 0.005
                ? `That's more than is left on this loan; the rest settles older ones with ${person!.name} first.`
                : "Link it to the loan it returns, so you can see exactly what came back."
            }
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip label="Oldest loans first" selected={!linkedLoan} onPress={() => setRepaysId(null)} />
              {openLoans.map((loan) => (
                <Chip
                  key={loan.transaction!.id}
                  label={loanLabel(loan, person!.currency)}
                  selected={linkedLoan === loan}
                  onPress={() => {
                    setRepaysId(loan.transaction!.id);
                    if (!amount.trim() && loan.remaining > 0) setAmount(String(Number(loan.remaining.toFixed(2))));
                  }}
                />
              ))}
            </View>
          </Field>
        )}

        {refundable && !paidByPerson && (refundCandidates.length > 0 || refundsId) && (
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
            <RefundsPicker
              type={refundable}
              candidates={refundCandidates}
              self={initial}
              selectedId={refundsId}
              amount={amountValue}
              date={dateDay}
              onSelect={(id, left) => {
                setRefundsId(id);
                if (id && left && left > 0 && (!amount.trim() || amountValue > left)) setAmount(String(Number(left.toFixed(2))));
              }}
            />
          </Field>
        )}

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 4 }}>
            <Field label="Date">
              <DateField value={date} onChange={setDate} />
            </Field>
          </View>
          <View style={{ flex: 3 }}>
            <Field label="Time">
              <TimeField value={time} onChange={setTime} />
            </Field>
          </View>
        </View>

        {isLending ? (
          startsLoan(kind) && !(canMarkNotReturning && notReturning) ? (
            <Field label="Return by" hint="Optional">
              <DateField value={dueDate} onChange={setDueDate} placeholder="No return date" clearable minimumDate={parseDay(date) ?? undefined} />
            </Field>
          ) : null
        ) : (
          <Field label="Payee" hint="Optional">
            <Input value={payee} onChangeText={setPayee} placeholder="Who was it paid to or from?" />
          </Field>
        )}

        <Field label={isLending ? (moneyGoesOut(kind) ? "Paid from" : "Received into") : "Account"}>
          {sourceAccounts.length === 0 ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>Add an account first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: "row", gap: 8 }}>
                {sourceAccounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => handleSelectAccount(a.id)} />
                ))}
              </View>
            </ScrollView>
          )}
          {paidByPerson && (
            <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 8 }}>
              {editingWriteOff
                ? type === "EXPENSE"
                  ? `Written off: takes this off what ${paidByPerson.name} owes you, without touching your accounts.`
                  : `Written off: takes this off what you owe ${paidByPerson.name}, without touching your accounts.`
                : type === "EXPENSE"
                  ? `${paidByPerson.name} paid, so this adds to what you owe them.`
                  : `${paidByPerson.name} received it for you, so this adds to what they owe you.`}
            </Text>
          )}
        </Field>

        {showCounted && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>{type === "EXPENSE" ? "Count as spending" : "Count as income"}</Text>
              <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
                {counted
                  ? type === "EXPENSE"
                    ? "Counted in spending and budgets."
                    : "Counted in income."
                  : "Moves the balance, but kept out of totals and budgets."}
              </Text>
            </View>
            <Toggle value={counted} onChange={setCounted} />
          </View>
        )}

        {type === "TRANSFER" ? (
          <Field
            label="Transfer to"
            hint={
              toMember
                ? `Money to ${memberName(toMember)}: lands in their ${toMember.name}. Not spending for you, nor income for them.`
                : memberTargets.length === 0
                  ? "Family members show up here once they share an account with the family."
                  : "Between your own accounts, or to a family member's shared account."
            }
          >
            {transferTargets.length === 0 && memberTargets.length === 0 ? (
              <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>Add another account to transfer to.</Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {transferTargets.map((a) => (
                  <Chip key={a.id} label={a.name} selected={transferToAccountId === a.id} onPress={() => setTransferToAccountId(a.id)} />
                ))}
              </View>
            )}
            {memberTargets.length > 0 && (
              <View style={{ gap: 8, marginTop: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Users size={13} color={colors.inkMuted} />
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.inkMuted }}>To a family member</Text>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {memberTargets.map((a) => (
                    <Chip
                      key={a.id}
                      label={`${memberName(a)} · ${a.name}`}
                      selected={transferToAccountId === a.id}
                      onPress={() => setTransferToAccountId(a.id)}
                    />
                  ))}
                </View>
              </View>
            )}
          </Field>
        ) : (
          <>
            {wantsBudgets && budgetChoices.length > 0 && (
              <Field
                label="Counts in budget"
                hint={countsIn.length > 0 ? budgetHint : "Pick the budget this comes out of, or a category below."}
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {budgetChoices.map((b) => (
                    <Chip
                      key={b.id}
                      label={`${budgetName(b)}${b.period === "ANNUAL" ? " · yearly" : ""}${b.ownerId ? "" : " · Family"}`}
                      color={overBudget && countsIn.includes(b) ? colors.expense : b.category.color}
                      selected={countsIn.includes(b)}
                      onPress={() => {
                        setAddingCategory(false);
                        pickCategory(countsIn.includes(b) ? null : b.categoryId);
                      }}
                    />
                  ))}
                </View>
              </Field>
            )}
            <Field
              label="Category"
              hint={
                isLending
                  ? "Optional — what it was for."
                  : familyTransfer
                    ? "Optional for a family transfer."
                    : payeeMatch && !targetTouched
                      ? payeeMatch.source === "rule"
                        ? `Filled in by your payee rule “${payeeMatch.rule!.payee}”.`
                        : "Filled in from how this payee was filed before."
                      : undefined
              }
            >
              <View style={{ gap: 12 }}>
                <CategoryPicker
                  categories={categoriesForType}
                  selectedId={categoryId}
                  onSelect={pickCategory}
                  clearLabel="No category"
                  onAddNew={family.role !== "VIEWER" && !addingCategory ? () => setAddingCategory(true) : undefined}
                />
                {addingCategory && (
                  <NewCategoryForm
                    familyId={family.id}
                    type={newCategoryType}
                    taken={categories}
                    onCreated={(created) => {
                      setCategories((list) => [...list, created]);
                      pickCategory(created.id);
                      setAddingCategory(false);
                    }}
                    onCancel={() => setAddingCategory(false)}
                  />
                )}
              </View>
            </Field>
          </>
        )}

        {canRemember && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Remember for this payee</Text>
              <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
                {`${sameRule ? "Change the rule: " : "Always file "}“${rememberPattern}” ${type === "INCOME" ? "income" : "expenses"} as ${rememberTarget}, from SMS too.`}
              </Text>
            </View>
            <Toggle value={rememberPayee} onChange={setRememberPayee} />
          </View>
        )}

        {canRepeat && (
          <Field
            label="Repeat"
            hint={
              repeat
                ? `${describeSchedule({ frequency: repeat, startDate: date.trim() })}, recorded automatically${
                    type === "EXPENSE" ? ` and counted in your ${repeat === "YEARLY" ? "yearly" : "monthly"} budget` : ""
                  }.`
                : "For a salary, rent, a home maker's pay or a subscription."
            }
          >
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip label="Doesn't repeat" selected={!repeat} onPress={() => setRepeat(null)} />
              {FREQUENCIES.map((f) => (
                <Chip key={f.value} label={f.label} selected={repeat === f.value} onPress={() => setRepeat(f.value)} />
              ))}
            </View>
          </Field>
        )}

        {isEdit && initial?.recurringId && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surfaceSunken }}>
            <Repeat size={16} color={colors.inkMuted} />
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.inkMuted }}>
              Recorded from a repeating payment. Changes here affect only this one.
            </Text>
            <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand600 }} onPress={() => router.push(href("/recurring"))}>
              Manage
            </Text>
          </View>
        )}

        <Field label="Notes" hint="Optional">
          <Input value={notes} onChangeText={setNotes} placeholder={isLending ? "What for?" : "Optional"} />
        </Field>

        <ErrorText>{error}</ErrorText>

        {!readOnly && (
          <View style={{ gap: 10 }}>
            <Button title={isEdit ? "Save changes" : "Save"} size="lg" loading={isSubmitting} disabled={!canSubmit} onPress={() => handleSave(false)} />
            {!isEdit && <Button title="Save & add another" variant="secondary" disabled={isSubmitting || !canSubmit} onPress={() => handleSave(true)} />}
          </View>
        )}

        {canDelete &&
          (confirmDelete ? (
            <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.expenseSoft }}>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                Delete this transaction? It will be removed from balances and reports.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Delete" variant="danger" loading={isDeleting} onPress={handleDelete} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" disabled={isDeleting} onPress={() => setConfirmDelete(false)} />
                </View>
              </View>
            </View>
          ) : (
            <Button
              title="Delete transaction"
              variant="ghost"
              icon={<Trash2 size={16} color={colors.expense} />}
              disabled={isSubmitting}
              onPress={() => setConfirmDelete(true)}
            />
          ))}
        </View>
      </FormScrollView>
    </View>
  );
}
