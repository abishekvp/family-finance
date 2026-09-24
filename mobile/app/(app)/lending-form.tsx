import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Plus } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Segmented, SkeletonRows, Toggle } from "../../src/components/ui";
import { currencySymbol } from "../../src/lib/format";
import { localDateInput } from "../../src/lib/dateUtils";
import { balanceAfter, describeBalance, entryLabel, isPerson, type LendingKind } from "../../src/lib/lending";
import { refreshTodayWidget } from "../../src/lib/todayWidget";

const KIND_OPTIONS: { value: LendingKind; label: string }[] = [
  { value: "gave", label: "I gave money" },
  { value: "got", label: "I got money" },
];

const KIND_HINT: Record<LendingKind, string> = {
  gave: "Lending to them, or paying back what you owe.",
  got: "Borrowing from them, or being paid back.",
};

/** Records money given to or received from a person, as a transfer that never counts as income or expense. */
export default function LendingForm() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; personId?: string; amount?: string }>();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [kind, setKind] = useState<LendingKind>(params.kind === "got" ? "got" : "gave");
  const [personId, setPersonId] = useState<string | null>(params.personId ?? null);
  const [addingPerson, setAddingPerson] = useState(false);
  const [newName, setNewName] = useState("");
  const [shared, setShared] = useState(false);
  const [amount, setAmount] = useState(params.amount ?? "");
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(localDateInput(new Date()));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A person created on a save whose transfer then failed — reused on retry, never created twice.
  const createdPerson = useRef<Account | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Account[]>(`/families/${family.id}/accounts`)
      .then((res) => {
        if (cancelled) return;
        setAccounts(res.data);
        if (!res.data.some(isPerson)) setAddingPerson(true);
        const firstOwn = res.data.find((a) => !isPerson(a));
        if (firstOwn) setAccountId(firstOwn.id);
      })
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err, "Unable to load accounts")))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [family.id]);

  const people = accounts.filter(isPerson);
  const ownAccounts = accounts.filter((a) => !isPerson(a));
  const person = addingPerson ? null : people.find((p) => p.id === personId) ?? null;
  const personName = addingPerson ? newName.trim() : person?.name ?? "";
  const symbol = currencySymbol(family.currency);

  const amountValue = Number(amount);
  const hasPerson = addingPerson ? newName.trim().length > 0 : !!person;
  const canSubmit = hasPerson && !!accountId && amount.trim().length > 0 && amountValue > 0 && date.trim().length > 0;

  const before = person?.balance ?? 0;
  const preview = hasPerson && amountValue > 0 ? describeBalance(personName, balanceAfter(before, kind, amountValue), family.currency) : null;

  function parseDate(): string | null {
    const trimmed = date.trim();
    // Today keeps the current time so it sorts after earlier entries; other days start at local midnight.
    if (trimmed === localDateInput(new Date())) return new Date().toISOString();
    const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  async function handleSave() {
    setError(null);
    const isoDate = parseDate();
    if (!isoDate) {
      setError("Enter the date as YYYY-MM-DD");
      return;
    }

    setIsSubmitting(true);
    try {
      let target = person;
      if (addingPerson) {
        if (!createdPerson.current || createdPerson.current.name !== personName) {
          const res = await api.post<Account>(`/families/${family.id}/accounts`, {
            name: personName,
            type: "PERSON",
            isCommon: shared,
            currency: family.currency,
            openingBalance: 0,
          });
          createdPerson.current = res.data;
        }
        target = createdPerson.current;
      }
      if (!target) return;

      await api.post(`/families/${family.id}/transactions`, {
        type: "TRANSFER",
        accountId: kind === "gave" ? accountId : target.id,
        transferToAccountId: kind === "gave" ? target.id : accountId,
        amount: amountValue,
        date: isoDate,
        payee: entryLabel(kind, before, target.name),
        notes: notes.trim() || null,
      });
      refreshTodayWidget(family.id, family.currency);
      router.back();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={5} />
      </View>
    );
  }

  const tone = kind === "gave" ? colors.expense : colors.income;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.canvas }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }} keyboardShouldPersistTaps="handled">
        <ErrorText>{loadError}</ErrorText>

        <View style={{ gap: 8 }}>
          <Segmented fullWidth value={kind} onChange={setKind} options={KIND_OPTIONS} />
          <Text style={{ color: colors.inkSubtle, fontSize: 12, textAlign: "center" }}>{KIND_HINT[kind]}</Text>
        </View>

        <Field label={kind === "gave" ? "To" : "From"}>
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
              <Chip label="New person" icon={<Plus size={13} color={addingPerson ? colors.white : colors.inkMuted} />} selected={addingPerson} onPress={() => setAddingPerson(true)} />
            )}
          </View>
          {addingPerson && (
            <View style={{ gap: 12, marginTop: people.length > 0 ? 12 : 0 }}>
              <Input value={newName} onChangeText={setNewName} placeholder="Their name" autoCapitalize="words" autoFocus={people.length > 0} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Share with family</Text>
                  <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>Off keeps this between you and them.</Text>
                </View>
                <Toggle value={shared} onChange={setShared} />
              </View>
            </View>
          )}
        </Field>

        <View style={{ alignItems: "center", backgroundColor: colors.surfaceSunken, borderRadius: 20, paddingVertical: 22 }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase", letterSpacing: 0.4 }}>Amount</Text>
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
          {preview && <Text style={{ marginTop: 6, fontSize: 13, fontWeight: "600", color: colors.inkMuted }}>{`After this: ${preview}`}</Text>}
        </View>

        <Field label={kind === "gave" ? "Paid from" : "Received into"}>
          {ownAccounts.length === 0 ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>Add an account first.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {ownAccounts.map((a) => (
                  <Chip key={a.id} label={a.name} selected={accountId === a.id} onPress={() => setAccountId(a.id)} />
                ))}
              </View>
            </ScrollView>
          )}
        </Field>

        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="Date">
              <Input value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Note" hint="Optional">
              <Input value={notes} onChangeText={setNotes} placeholder="What for?" />
            </Field>
          </View>
        </View>

        <ErrorText>{error}</ErrorText>

        <Button title="Save" size="lg" loading={isSubmitting} disabled={!canSubmit} onPress={handleSave} />
        <Text style={{ color: colors.inkSubtle, fontSize: 12, textAlign: "center" }}>
          Recorded as a transfer, so it changes your account balance but never your income or expenses.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
