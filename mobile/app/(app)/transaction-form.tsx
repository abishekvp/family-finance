import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Plus, Trash2 } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account, Category, Transaction, TransactionType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Segmented, SkeletonRows, Toggle } from "../../src/components/ui";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { currencySymbol } from "../../src/lib/format";
import { localDateInput } from "../../src/lib/dateUtils";
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
  moneyGoesOut,
  parseKind,
  startsLoan,
  withoutKindTag,
  type LendingKind,
} from "../../src/lib/lending";
import { refreshTodayWidget } from "../../src/lib/todayWidget";
import { moveToBackground } from "../../modules/home-widgets";

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
  // `type`, `accountId`, `personId`, `kind` and `amount` preset a new entry; `source=widget` marks a
  // home-screen quick add.
  const params = useLocalSearchParams<{
    id?: string;
    transaction?: string;
    type?: string;
    accountId?: string;
    personId?: string;
    kind?: string;
    amount?: string;
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
    Promise.all([api.get<Account[]>(`/families/${family.id}/accounts`), api.get<Category[]>(`/families/${family.id}/categories`)])
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
  // A person created by a save whose transaction then failed — reused on retry, never created twice.
  const createdPerson = useRef<Account | null>(null);
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
  const symbol = currencySymbol(selectedAccount?.currency ?? family.currency);

  const person = isLending && !addingPerson ? people.find((p) => p.id === personId) ?? null : null;
  const personName = addingPerson ? newPersonName.trim() : person?.name ?? "";
  const hasPerson = addingPerson ? personName.length > 0 : !!person;

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
      // An entry turned from Lend/Borrow into something else stops being a loan.
      ...(initial ? { tags: withoutKindTag(initial.tags), dueDate: null } : {}),
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
      } else {
        await api.post(`/families/${family.id}/transactions`, payload);
      }
      refreshTodayWidget(family.id, family.currency);
      if (andAddAnother && !isEdit) {
        setAmount("");
        setPayee("");
        setNotes("");
        setDueDate("");
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
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
        <ErrorText>{loadError}</ErrorText>

        <Segmented fullWidth value={type} onChange={handleSelectType} options={TYPE_OPTIONS} />

        {isLending && (
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {LENDING_KINDS.map((k) => (
                <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
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
                    setPersonId(p.id);
                  }}
                />
              ))}
              {people.length > 0 && (
                <Chip
                  label="New person"
                  icon={<Plus size={13} color={addingPerson ? colors.white : colors.inkMuted} />}
                  selected={addingPerson}
                  onPress={() => setAddingPerson(true)}
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
          <Field label="Category" hint={isLending ? "Optional — what it was for. Tap again to clear." : undefined}>
            {categoriesForType.length === 0 ? (
              <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No {isLending ? "" : `${type.toLowerCase()} `}categories yet.</Text>
            ) : (
              <CategoryPicker
                categories={categoriesForType}
                selectedId={categoryId}
                onSelect={(id) => setCategoryId(isLending && id === categoryId ? null : id)}
              />
            )}
          </Field>
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
