import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowRightLeft, MinusCircle, PlusCircle, Trash2 } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account, Category, Transaction, TransactionType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Segmented, SkeletonRows } from "../../src/components/ui";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { currencySymbol } from "../../src/lib/format";
import { localDateInput } from "../../src/lib/dateUtils";
import { href } from "../../src/lib/nav";
import { isPerson } from "../../src/lib/lending";
import { refreshTodayWidget } from "../../src/lib/todayWidget";
import { moveToBackground } from "../../modules/home-widgets";

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
  { value: "TRANSFER", label: "Transfer" },
];

const TYPE_ICON = { INCOME: PlusCircle, EXPENSE: MinusCircle, TRANSFER: ArrowRightLeft };

function todayIso() {
  return localDateInput(new Date());
}

function parseType(value: string | undefined): TransactionType | null {
  return TYPE_OPTIONS.some((o) => o.value === value) ? (value as TransactionType) : null;
}

export default function TransactionForm() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const router = useRouter();
  const navigation = useNavigation();
  // `type` and `accountId` preset a new transaction; `source=widget` marks a home-screen quick add.
  const params = useLocalSearchParams<{ id?: string; transaction?: string; type?: string; accountId?: string; source?: string }>();

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

  const [type, setType] = useState<TransactionType>(initial?.type ?? parseType(params.type) ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? params.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [transferToAccountId, setTransferToAccountId] = useState<string | null>(initial?.transferToAccountId ?? null);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
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

  useEffect(() => {
    if (accountId || accounts.length === 0) return;
    // Start on a real account, never on a friend's lend & borrow tab.
    setAccountId((accounts.find((a) => !isPerson(a)) ?? accounts[0]).id);
  }, [accounts, accountId]);

  const categoriesForType = categories.filter((c) => c.type === (type === "TRANSFER" ? "EXPENSE" : type));
  // People are transfer ends (lend & borrow). For income and expenses they only show once chosen,
  // e.g. from a person's "paid for something".
  const sourceAccounts = accounts.filter((a) => !isPerson(a) || type === "TRANSFER" || a.id === accountId);
  const transferTargets = accounts.filter((a) => a.id !== accountId);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const paidByPerson = selectedAccount && isPerson(selectedAccount) && type !== "TRANSFER" ? selectedAccount : null;
  const symbol = currencySymbol(selectedAccount?.currency ?? "USD");

  const amountValue = Number(amount);
  const canSubmit =
    !!accountId && amount.trim().length > 0 && amountValue > 0 && date.trim().length > 0 && (type !== "TRANSFER" || (!!transferToAccountId && transferToAccountId !== accountId));

  function handleSelectType(next: TransactionType) {
    setType(next);
    if (next === "TRANSFER") setCategoryId(null);
    else setTransferToAccountId(null);
  }

  function handleSelectAccount(id: string) {
    setAccountId(id);
    if (transferToAccountId === id) setTransferToAccountId(null);
  }

  function buildPayload(): Record<string, unknown> | null {
    const trimmedDate = date.trim();
    const parsed = new Date(trimmedDate.length === 10 ? `${trimmedDate}T00:00:00` : trimmedDate);
    if (Number.isNaN(parsed.getTime())) {
      setError("Enter the date as YYYY-MM-DD");
      return null;
    }
    // Keep the original time (SMS imports carry the alert's) unless the day itself was changed.
    const unchangedDay = initial && trimmedDate === localDateInput(new Date(initial.date));
    return {
      accountId,
      type,
      amount: amountValue,
      date: unchangedDay ? initial.date : parsed.toISOString(),
      categoryId: type === "TRANSFER" ? null : categoryId,
      transferToAccountId: type === "TRANSFER" ? transferToAccountId : null,
      payee: payee.trim() || null,
      notes: notes.trim() || null,
    };
  }

  async function handleSave(andAddAnother: boolean) {
    setError(null);
    const payload = buildPayload();
    if (!payload) return;

    setIsSubmitting(true);
    try {
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
        setDate(todayIso());
      } else {
        close();
      }
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update transaction" : "Unable to create transaction"));
    } finally {
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
    } finally {
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

  const typeTone = type === "INCOME" ? colors.income : type === "EXPENSE" ? colors.expense : colors.brand600;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <ErrorText>{loadError}</ErrorText>

        <Segmented
          fullWidth
          value={type}
          onChange={handleSelectType}
          options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />

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
        </View>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Date">
              <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Payee" hint="Optional">
              <Input value={payee} onChangeText={setPayee} placeholder="Optional" />
            </Field>
          </View>
        </View>

        <Field label="Account">
          {accounts.length === 0 ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>Add an account first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
          <Field label="Category">
            {categoriesForType.length === 0 ? (
              <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No {type.toLowerCase()} categories yet.</Text>
            ) : (
              <CategoryPicker categories={categoriesForType} selectedId={categoryId} onSelect={setCategoryId} />
            )}
          </Field>
        )}

        <Field label="Notes" hint="Optional">
          <Input value={notes} onChangeText={setNotes} placeholder="Optional" />
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
