import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { Trash2 } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account, Category, RecurringFrequency, RecurringTransaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Segmented, SkeletonRows, Toggle } from "../../src/components/ui";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { currencySymbol } from "../../src/lib/format";
import { localDateInput } from "../../src/lib/dateUtils";
import { isPerson } from "../../src/lib/lending";
import { FREQUENCIES, describeSchedule, runRecurring } from "../../src/lib/recurring";

type RuleType = "EXPENSE" | "INCOME";

function isDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(new Date(`${value.trim()}T00:00:00`).getTime());
}

/** Adds or edits a repeating payment. Opened with `rule` (JSON) to edit. */
export default function RecurringForm() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canEdit = family.role !== "VIEWER";
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ rule?: string }>();

  const initial = useMemo<RecurringTransaction | null>(() => {
    if (!params.rule) return null;
    try {
      return JSON.parse(params.rule) as RecurringTransaction;
    } catch {
      return null;
    }
  }, [params.rule]);
  const isEdit = !!initial;

  useLayoutEffect(() => {
    navigation.setOptions({ title: isEdit ? "Edit repeating payment" : "New repeating payment" });
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
        setAccounts(accountsRes.data.filter((a) => !isPerson(a)));
        setCategories(categoriesRes.data);
      })
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err, "Unable to load form data")))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [family.id]);

  const [type, setType] = useState<RuleType>(initial?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [frequency, setFrequency] = useState<RecurringFrequency>(initial?.frequency ?? "MONTHLY");
  // For a new payment, its first day; for an existing one, its next day.
  const [day, setDay] = useState(initial?.nextDate ?? localDateInput(new Date()));
  const [endDate, setEndDate] = useState(initial?.endDate ?? "");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const categoriesForType = categories.filter((c) => c.type === type);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const symbol = currencySymbol(selectedAccount?.currency ?? family.currency);
  const amountValue = Number(amount);
  const canSubmit = canEdit && !!accountId && amount.trim().length > 0 && amountValue > 0 && day.trim().length > 0;
  const tone = type === "EXPENSE" ? colors.expense : colors.income;

  function handleSelectType(next: RuleType) {
    setType(next);
    const current = categories.find((c) => c.id === categoryId);
    if (current && current.type !== next) setCategoryId(null);
  }

  async function handleSave() {
    setError(null);
    if (!isDay(day)) return setError("Enter the date as YYYY-MM-DD");
    if (endDate.trim() && !isDay(endDate)) return setError("Enter the end date as YYYY-MM-DD");
    if (endDate.trim() && endDate.trim() < day.trim()) return setError("The end date is before the payment date");

    setIsSaving(true);
    try {
      const common = {
        type,
        amount: amountValue,
        accountId,
        categoryId,
        payee: payee.trim() || null,
        notes: notes.trim() || null,
        endDate: endDate.trim() || null,
      };
      if (isEdit && initial) {
        await api.patch(`/families/${family.id}/recurring/${initial.id}`, {
          ...common,
          isActive,
          // Only a changed schedule restarts it from the next payment.
          ...(frequency !== initial.frequency ? { frequency } : {}),
          ...(day.trim() !== initial.nextDate || frequency !== initial.frequency ? { nextDate: day.trim() } : {}),
        });
      } else {
        await api.post(`/families/${family.id}/recurring`, { ...common, frequency, startDate: day.trim() });
      }
      // A payment due today (or earlier) is recorded straight away.
      await runRecurring(family.id, { force: true });
      router.back();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save"));
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    setIsDeleting(true);
    try {
      await api.delete(`/families/${family.id}/recurring/${initial.id}`);
      router.back();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete"));
      setConfirmDelete(false);
      setIsDeleting(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={5} />
      </View>
    );
  }

  const budgetHint =
    type !== "EXPENSE"
      ? "Recorded as income on each date."
      : frequency === "YEARLY"
        ? "Recorded on each date and counted in your yearly budget for its category."
        : "Recorded on each date and counted in your monthly budget for its category.";

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
        <ErrorText>{loadError}</ErrorText>

        <Segmented
          fullWidth
          value={type}
          onChange={handleSelectType}
          options={[
            { value: "EXPENSE", label: "Expense" },
            { value: "INCOME", label: "Income" },
          ]}
        />

        <View style={{ alignItems: "center", backgroundColor: colors.surfaceSunken, borderRadius: 20, paddingVertical: 22 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase", letterSpacing: 0.4 }}>Amount each time</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
            <Text style={{ fontSize: 22, color: tone, opacity: 0.7 }}>{symbol}</Text>
            <Input
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              style={{
                borderWidth: 0,
                backgroundColor: "transparent",
                height: 60,
                paddingVertical: 0,
                includeFontPadding: false,
                textAlignVertical: "center",
                fontSize: 34,
                fontWeight: "800",
                color: tone,
                textAlign: "center",
                minWidth: 140,
              }}
            />
          </View>
        </View>

        <Field label="Name">
          <Input value={payee} onChangeText={setPayee} placeholder={type === "EXPENSE" ? "e.g. Maid salary, Netflix, Rent" : "e.g. Salary"} />
        </Field>

        <Field label="Repeats" hint={isDay(day) ? `${describeSchedule({ frequency, startDate: day.trim() })}. ${budgetHint}` : budgetHint}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {FREQUENCIES.map((f) => (
              <Chip key={f.value} label={f.label} selected={frequency === f.value} onPress={() => setFrequency(f.value)} />
            ))}
          </View>
        </Field>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label={isEdit ? "Next payment" : "First payment"}>
              <Input value={day} onChangeText={setDay} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Ends on" hint="Optional">
              <Input value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
        </View>

        <Field label={type === "EXPENSE" ? "Paid from" : "Paid into"}>
          {accounts.length === 0 ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>Add an account first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: "row", gap: 8 }}>
                {accounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
                ))}
              </View>
            </ScrollView>
          )}
        </Field>

        <Field label="Category" hint={type === "EXPENSE" ? "Its budget is where this counts." : undefined}>
          {categoriesForType.length === 0 ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No {type.toLowerCase()} categories yet.</Text>
          ) : (
            <CategoryPicker categories={categoriesForType} selectedId={categoryId} onSelect={(id) => setCategoryId(id === categoryId ? null : id)} />
          )}
        </Field>

        <Field label="Notes" hint="Optional">
          <Input value={notes} onChangeText={setNotes} placeholder="Optional" />
        </Field>

        {isEdit && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Active</Text>
              <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>Off pauses it; nothing new is recorded.</Text>
            </View>
            <Toggle value={isActive} onChange={setIsActive} />
          </View>
        )}

        <ErrorText>{error}</ErrorText>

        {canEdit && <Button title={isEdit ? "Save changes" : "Save"} size="lg" loading={isSaving} disabled={!canSubmit} onPress={handleSave} />}

        {isEdit &&
          canEdit &&
          (confirmDelete ? (
            <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.expenseSoft }}>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                Delete this repeating payment? Payments already recorded stay in your transactions.
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
            <Button title="Delete repeating payment" variant="ghost" icon={<Trash2 size={16} color={colors.expense} />} onPress={() => setConfirmDelete(true)} />
          ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
