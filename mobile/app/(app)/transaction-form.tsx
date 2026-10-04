import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowRight, Plus, Repeat, Trash2 } from "lucide-react-native";
import { api } from "../../src/api/client";
import { fetchWithCache } from "../../src/lib/cache";
import type { Account, Budget, Category, RecurringFrequency, Transaction, TransactionType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { ClientError, getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Segmented, SkeletonRows, Toggle } from "../../src/components/ui";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { RefundsPicker } from "../../src/components/RefundsPicker";
import { NewCategoryForm } from "../../src/components/NewCategoryForm";
import { currencySymbol, formatCurrency } from "../../src/lib/format";
import { MONTH_LABELS, localDateInput } from "../../src/lib/dateUtils";
import { href } from "../../src/lib/nav";
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
} from "../../src/lib/lending";
import { refreshTodayWidget } from "../../src/lib/todayWidget";
import { useTransactions } from "../../src/lib/transactionStore";
import { FREQUENCIES, describeSchedule } from "../../src/lib/recurring";
import { moveToBackground } from "../../modules/home-widgets";
import { budgetName } from "../../src/lib/budgets";

/** "LENDING" is saved as a transfer between one of your accounts and a person. */
type FormType = TransactionType | "LENDING";

const TYPE_OPTIONS: { value: FormType; label: string }[] = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "LENDING", label: "Lend/Borrow" },
];

function todayIso() {
  return localDateInput(new Date());
}

function parseType(value: string | undefined): FormType | null {
  return TYPE_OPTIONS.some((o) => o.value === value) ? (value as FormType) : null;
}

/** A YYYY-MM-DD day as local midnight, or null when it isn't a date. */
function parseDay(value: string): Date | null {
  const trimmed = value.trim();
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? "Edit transaction" : "Add transaction" });
  }, [navigation, isEdit]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchWithCache<Account[]>(`/families/${family.id}/accounts`, undefined, (cached) => {
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
  const [transferToAccountId, setTransferToAccountId] = useState<string | null>(initial?.transferToAccountId ?? null);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : params.amount ?? "");
  // Local day, not initial.date.slice(0, 10): that is the UTC day, and re-saving it would shift
  // the transaction back a day east of UTC.
  const [date, setDate] = useState(initial ? localDateInput(new Date(initial.date)) : todayIso());
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const canDelete = isEdit && family.role !== "VIEWER";

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
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const paidByPerson = selectedAccount && isPerson(selectedAccount) && !isLending && type !== "TRANSFER" ? selectedAccount : null;
  // A salary, rent or subscription can be set to repeat as it's added (not from a person's account).
  const canRepeat = !isEdit && (type === "INCOME" || type === "EXPENSE") && !paidByPerson;
  const symbol = currencySymbol(selectedAccount?.currency ?? family.currency);

  const person = isLending && !addingPerson ? people.find((p) => p.id === personId) ?? null : null;
  const personName = addingPerson ? newPersonName.trim() : person?.name ?? "";
  const hasPerson = addingPerson ? personName.length > 0 : !!person;

  // A return can say which loan it pays back. This entry's own earlier save is left out, so the
  // loans read as they stood before it.
  const repaying = isLending && person ? repaidDirection(kind) : null;
  const personLoanId = repaying ? person!.id : null;
  const personLoanFilter = useMemo(() => (personLoanId ? { accountId: personLoanId } : null), [personLoanId]);
  const { transactions: personHistory } = useTransactions(user!.id, family.id, personLoanFilter);
  const openLoans = useMemo(() => {
    if (!repaying || !person) return [];
    const history = personHistory.filter((t) => t.id !== initial?.id && (t.accountId === person.id || t.transferToAccountId === person.id));
    return trackLoans(history, person).filter((l) => l.transaction && l.direction === repaying && (!l.settled || l.transaction.id === repaysId));
  }, [repaying, person, personHistory, initial?.id, repaysId]);
  const linkedLoan = openLoans.find((l) => l.transaction!.id === repaysId) ?? null;
  
  const expenseFilter = useMemo(() => (type === "INCOME" ? { type: "EXPENSE" as const } : null), [type]);
  const { transactions: expenses } = useTransactions(user!.id, family.id, expenseFilter);
  const recentExpenses = useMemo(() => expenses.filter((t) => !t.isDeleted && !t.isRefunded && t.id !== initial?.id).slice(0, 30), [expenses, initial?.id]);
  const linkedRefund = recentExpenses.find((t) => t.id === refundsId) || (initial?.refundsId ? { id: initial.refundsId, payee: "an expense", amount: 0, date: "" } as any : null);

  // New categories are income or expense; for Lend/Borrow, by which way the money went.
  const newCategoryType = isLending ? (moneyGoesOut(kind) ? "EXPENSE" : "INCOME") : type === "INCOME" ? "INCOME" : "EXPENSE";

  const amountValue = Number(amount);
  const canSubmit =
    !!accountId &&
    amount.trim().length > 0 &&
    amountValue > 0 &&
    date.trim().length > 0 &&
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
    return describeBalance(personName, before + balanceEffect(kind, amountValue), person?.currency ?? family.currency);
  })();

  // The budgets an expense counts in: those for its date's month, and the yearly ones.
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const dateDay = parseDay(date);
  const budgetYear = dateDay?.getFullYear();
  const budgetMonth = dateDay ? dateDay.getMonth() + 1 : undefined;
  const wantsBudgets = type === "EXPENSE";
  useEffect(() => {
    if (!wantsBudgets || !budgetYear || !budgetMonth) return;
    let cancelled = false;
    const url = `/families/${family.id}/budgets`;
    Promise.all([
      fetchWithCache<Budget[]>(url, { params: { year: budgetYear, month: budgetMonth } }, (cached) => {
        if (!cancelled) setBudgets((prev) => [...cached.data, ...prev.filter(b => b.period === "ANNUAL")]); // A bit rough but we'll just let the then block overwrite it completely.
      }),
      fetchWithCache<Budget[]>(url, { params: { year: budgetYear, period: "ANNUAL" } }, (cached) => {
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
  const canBeLoanReturn = (type === "INCOME" || type === "EXPENSE") && !paidByPerson && !initial?.recurringId;
  function recordAsLoanReturn() {
    const nextKind: LendingKind = type === "INCOME" ? "got-back" : "paid-back";
    const typedName = payee.trim().toLowerCase();
    const match = typedName ? people.find((p) => p.name.trim().toLowerCase() === typedName) : undefined;
    handleSelectType("LENDING");
    setKind(nextKind);
    setRepaysId(null); setRefundsId(null);
    if (match) {
      setAddingPerson(false);
      setPersonId(match.id);
    }
  }

  function handleSelectType(next: FormType) {
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

  /** Checks the typed dates before anything is saved (or a new person created). */
  function validateDates() {
    if (!parseDay(date)) {
      setError("Enter the date as YYYY-MM-DD");
      return false;
    }
    if (isLending && startsLoan(kind) && dueDate.trim() && !parseDay(dueDate)) {
      setError("Enter the return date as YYYY-MM-DD");
      return false;
    }
    return true;
  }

  /** The request body; dates must already be valid (see validateDates). */
  function buildPayload(personAccountId: string | null): Record<string, unknown> {
    const trimmedDate = date.trim();
    const parsed = parseDay(trimmedDate)!;
    const payloadRepaysId = repaying ? repaysId : null;
    // Keep the original time (SMS imports carry the alert's) unless the day itself was changed.
    // A new entry for today keeps the current time, so it sorts after today's earlier ones.
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
        tags: [...withoutKindTag(initial?.tags ?? []), kindTag(kind)],
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
      refundsId: type === "INCOME" ? refundsId : null,
      // An entry turned from Lend/Borrow into something else stops being a loan.
      ...(initial ? { tags: withoutKindTag(initial.tags), dueDate: null, repaysId: null, ...(type !== "INCOME" ? { refundsId: null } : {}) } : {}),
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
      const payload = buildPayload(isLending ? await resolvePersonId() : null);
      if (isEdit && initial) {
        await api.patch(`/families/${family.id}/transactions/${initial.id}`, payload);
      } else if (!savedTransactionId.current) {
        const res = await api.post<Transaction>(`/families/${family.id}/transactions`, payload);
        savedTransactionId.current = res.data.id;
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
      refreshTodayWidget(family.id, family.currency);
      if (andAddAnother && !isEdit) {
        setAmount("");
        setPayee("");
        setNotes("");
        setDueDate("");
        setRepaysId(null); setRefundsId(null);
        setRefundsId(null);
        setRepeat(null);
        setDate(todayIso());
        if (isLending) {
          // A person just added is now one of the chips, with an up-to-date balance.
          const res = await api.get<Account[]>(`/families/${family.id}/accounts`);
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 64 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={true}>
        <ErrorText>{loadError}</ErrorText>

        <Segmented fullWidth value={type} onChange={handleSelectType} options={TYPE_OPTIONS} />

        {canBeLoanReturn && (
          <Pressable
            onPress={recordAsLoanReturn}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 12,
              borderRadius: 14,
              backgroundColor: colors.surfaceSunken,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.inkMuted }}>
              {type === "INCOME" ? "Money someone returned? " : "Paying back money you borrowed? "}
              <Text style={{ fontWeight: "700", color: colors.brand600 }}>{type === "INCOME" ? "Record it as a loan return" : "Record it as a loan payback"}</Text>
            </Text>
            <ArrowRight size={15} color={colors.brand600} />
          </Pressable>
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
                    setRepaysId(null); setRefundsId(null);
                  }}
                />
              ))}
            </View>
            <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
              {LENDING_KINDS.find((k) => k.value === kind)?.hint}. Never counted as income or an expense.
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
                    if (p.id !== personId) setRepaysId(null); setRefundsId(null);
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
                    setRepaysId(null); setRefundsId(null);
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

        {type === "INCOME" && recentExpenses.length > 0 && (
          <Field
            label="Refunds Expense"
            hint={
              linkedRefund
                ? "This income will cancel out the selected expense in your budgets."
                : "Select an expense to mark this income as a refund."
            }
          >
            <RefundsPicker
              expenses={recentExpenses}
              selectedId={refundsId}
              familyCurrency={family.currency}
              onSelect={(id) => {
                setRefundsId(id);
                if (id) {
                  const expense = recentExpenses.find((e) => e.id === id);
                  if (expense && !amount.trim()) setAmount(String(expense.amount));
                }
              }}
            />
          </Field>
        )}

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Date">
              <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            {isLending ? (
              startsLoan(kind) ? (
                <Field label="Return by" hint="Optional">
                  <Input value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
                </Field>
              ) : null
            ) : (
              <Field label="Payee" hint="Optional">
                <Input value={payee} onChangeText={setPayee} placeholder="Optional" />
              </Field>
            )}
          </View>
        </View>

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
              {type === "EXPENSE"
                ? `${paidByPerson.name} paid, so this adds to what you owe them.`
                : `${paidByPerson.name} received it for you, so this adds to what they owe you.`}
            </Text>
          )}
        </Field>

        {type === "TRANSFER" ? (
          <Field label="Transfer to">
            {transferTargets.length === 0 ? (
              <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>Add another account to transfer to.</Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {transferTargets.map((a) => (
                  <Chip key={a.id} label={a.name} selected={transferToAccountId === a.id} onPress={() => setTransferToAccountId(a.id)} />
                ))}
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
                        setCategoryId(countsIn.includes(b) ? null : b.categoryId);
                      }}
                    />
                  ))}
                </View>
              </Field>
            )}
            <Field label="Category" hint={isLending ? "Optional — what it was for. Tap again to clear." : "Tap again to clear."}>
              <View style={{ gap: 12 }}>
                <CategoryPicker
                  categories={categoriesForType}
                  selectedId={categoryId}
                  onSelect={(id) => setCategoryId(id === categoryId ? null : id)}
                  onAddNew={family.role !== "VIEWER" && !addingCategory ? () => setAddingCategory(true) : undefined}
                />
                {addingCategory && (
                  <NewCategoryForm
                    familyId={family.id}
                    type={newCategoryType}
                    taken={categories}
                    onCreated={(created) => {
                      setCategories((list) => [...list, created]);
                      setCategoryId(created.id);
                      setAddingCategory(false);
                    }}
                    onCancel={() => setAddingCategory(false)}
                  />
                )}
              </View>
            </Field>
          </>
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

        <View style={{ gap: 10 }}>
          <Button title={isEdit ? "Save changes" : "Save"} size="lg" loading={isSubmitting} disabled={!canSubmit} onPress={() => handleSave(false)} />
          {!isEdit && <Button title="Save & add another" variant="secondary" disabled={isSubmitting || !canSubmit} onPress={() => handleSave(true)} />}
        </View>

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
