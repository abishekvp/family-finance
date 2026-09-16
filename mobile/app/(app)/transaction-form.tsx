import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { api } from "../../src/api/client";
import type { Account, Category, Transaction, TransactionType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors, pillStyle, pillTextStyle } from "../../src/components/ui";
import { CategoryPicker } from "../../src/components/CategoryPicker";

const TRANSACTION_TYPES: TransactionType[] = ["INCOME", "EXPENSE", "TRANSFER"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function TransactionForm() {
  const { user } = useAuth();
  const family = user!.families[0];
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string; transaction?: string }>();

  const initial = useMemo<Transaction | null>(() => {
    if (!params.transaction) return null;
    try {
      return JSON.parse(params.transaction) as Transaction;
    } catch {
      return null;
    }
  }, [params.transaction]);
  const isEdit = !!initial;

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
      api.get<Account[]>(`/families/${family.id}/accounts`),
      api.get<Category[]>(`/families/${family.id}/categories`),
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

  const [type, setType] = useState<TransactionType>(initial?.type ?? "EXPENSE");
  const [accountId, setAccountId] = useState(initial?.accountId ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [transferToAccountId, setTransferToAccountId] = useState<string | null>(initial?.transferToAccountId ?? null);
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [date, setDate] = useState(initial ? initial.date.slice(0, 10) : todayIso());
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  const categoriesForType = categories.filter((c) => c.type === (type === "TRANSFER" ? "EXPENSE" : type));
  const transferTargets = accounts.filter((a) => a.id !== accountId);

  const amountValue = Number(amount);
  const canSubmit =
    !!accountId &&
    amount.trim().length > 0 &&
    amountValue > 0 &&
    date.trim().length > 0 &&
    (type !== "TRANSFER" || (!!transferToAccountId && transferToAccountId !== accountId));

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
    return {
      accountId,
      type,
      amount: amountValue,
      date: parsed.toISOString(),
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
      if (andAddAnother && !isEdit) {
        setAmount("");
        setPayee("");
        setNotes("");
        setDate(todayIso());
      } else {
        router.back();
      }
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update transaction" : "Unable to create transaction"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.slate50, padding: 16 }}>
        <Text style={{ color: colors.slate400 }}>Loading...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.slate50 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <ErrorText>{loadError}</ErrorText>

        <Card style={{ gap: 16 }}>
          <View>
            <Label>Type</Label>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {TRANSACTION_TYPES.map((t) => (
                <Pressable key={t} onPress={() => handleSelectType(t)} style={pillStyle(type === t)}>
                  <Text style={pillTextStyle(type === t)}>{t}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Label>Date</Label>
            <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          </View>

          <View>
            <Label>Amount</Label>
            <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" />
          </View>

          <View>
            <Label>Account</Label>
            {accounts.length === 0 ? (
              <Text style={{ color: colors.slate400, fontSize: 13 }}>Add an account first.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {accounts.map((a) => (
                    <Pressable key={a.id} onPress={() => handleSelectAccount(a.id)} style={pillStyle(accountId === a.id)}>
                      <Text style={pillTextStyle(accountId === a.id)}>{a.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>

          {type === "TRANSFER" ? (
            <View>
              <Label>Transfer to</Label>
              {transferTargets.length === 0 ? (
                <Text style={{ color: colors.slate400, fontSize: 13 }}>Add another account to transfer to.</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {transferTargets.map((a) => (
                      <Pressable
                        key={a.id}
                        onPress={() => setTransferToAccountId(a.id)}
                        style={pillStyle(transferToAccountId === a.id)}
                      >
                        <Text style={pillTextStyle(transferToAccountId === a.id)}>{a.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
          ) : (
            <View>
              <Label>Category</Label>
              {categoriesForType.length === 0 ? (
                <Text style={{ color: colors.slate400, fontSize: 13 }}>No {type.toLowerCase()} categories yet.</Text>
              ) : (
                <CategoryPicker categories={categoriesForType} selectedId={categoryId} onSelect={setCategoryId} />
              )}
            </View>
          )}

          <View>
            <Label>Payee</Label>
            <Input value={payee} onChangeText={setPayee} placeholder="Optional" />
          </View>

          <View>
            <Label>Notes</Label>
            <Input value={notes} onChangeText={setNotes} placeholder="Optional" />
          </View>

          <ErrorText>{error}</ErrorText>

          <View style={{ gap: 8 }}>
            <Button
              title={isSubmitting ? "Saving..." : isEdit ? "Save changes" : "Save"}
              onPress={() => handleSave(false)}
              disabled={isSubmitting || !canSubmit}
            />
            {!isEdit && (
              <Button
                title="Save & add another"
                variant="secondary"
                onPress={() => handleSave(true)}
                disabled={isSubmitting || !canSubmit}
              />
            )}
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
