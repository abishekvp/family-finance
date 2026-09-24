import { useCallback, useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, Pencil, ShoppingBag, Trash2 } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account, Transaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Avatar, Button, Card, ErrorText, Field, Input, Sheet, SkeletonRows } from "../../src/components/ui";
import { formatCurrency } from "../../src/lib/format";
import { href } from "../../src/lib/nav";
import { describeBalance, describeEntry, isSettled, type LendingKind } from "../../src/lib/lending";

export default function LendingPerson() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canRecord = family.role !== "VIEWER";
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [person, setPerson] = useState<Account | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [accountsRes, historyRes] = await Promise.all([
        api.get<Account[]>(`/families/${family.id}/accounts`),
        api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { accountId: id, limit: 1000 } }),
      ]);
      const found = accountsRes.data.find((a) => a.id === id) ?? null;
      setPerson(found);
      setHistory(historyRes.data);
      setError(found ? null : "This person was removed.");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: person?.name ?? "Lend & borrow" });
  }, [navigation, person?.name]);

  function record(kind: LendingKind, amount?: number) {
    router.push(href("/lending-form", { kind, personId: id, ...(amount ? { amount: String(Number(amount.toFixed(2))) } : {}) }));
  }

  async function handleRemove() {
    setIsRemoving(true);
    try {
      await api.delete(`/families/${family.id}/accounts/${id}`);
      router.back();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to remove"));
      setConfirmRemove(false);
    } finally {
      setIsRemoving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={5} />
      </View>
    );
  }

  if (!person) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <ErrorText>{error}</ErrorText>
      </View>
    );
  }

  const balance = person.balance;
  const settled = isSettled(balance);
  const theyOwe = balance > 0;

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ alignItems: "center", gap: 10, paddingVertical: 22 }}>
        <Avatar name={person.name} size={52} />
        <Text
          style={{
            fontSize: 19,
            fontWeight: "800",
            textAlign: "center",
            color: settled ? colors.inkMuted : theyOwe ? colors.income : colors.expense,
          }}
        >
          {describeBalance(person.name, balance, person.currency)}
        </Text>
        {!person.owner && <Text style={{ fontSize: 12, color: colors.inkSubtle }}>Shared with your family</Text>}
      </Card>

      <ErrorText>{error}</ErrorText>

      {canRecord && (
        <View style={{ gap: 10 }}>
          {settled ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Lend" icon={<ArrowUpRight size={16} color={colors.white} />} onPress={() => record("gave")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Borrow" variant="secondary" icon={<ArrowDownLeft size={16} color={colors.ink} />} onPress={() => record("got")} />
              </View>
            </View>
          ) : theyOwe ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Got paid back" icon={<ArrowDownLeft size={16} color={colors.white} />} onPress={() => record("got", balance)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Lend more" variant="secondary" icon={<ArrowUpRight size={16} color={colors.ink} />} onPress={() => record("gave")} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button title="Pay back" icon={<ArrowUpRight size={16} color={colors.white} />} onPress={() => record("gave", -balance)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Borrow more" variant="secondary" icon={<ArrowDownLeft size={16} color={colors.ink} />} onPress={() => record("got")} />
              </View>
            </View>
          )}
          <Button
            title={`${person.name} paid for something`}
            variant="ghost"
            icon={<ShoppingBag size={16} color={colors.ink} />}
            onPress={() => router.push(href("/transaction-form", { type: "EXPENSE", accountId: person.id }))}
          />
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: "800", color: colors.inkSubtle, textTransform: "uppercase", paddingHorizontal: 2 }}>History</Text>
        {history.length === 0 ? (
          <Text style={{ color: colors.inkSubtle, fontSize: 13, paddingHorizontal: 2 }}>Nothing recorded yet.</Text>
        ) : (
          <Card style={{ padding: 0 }}>
            {history.map((t, i) => (
              <HistoryRow
                key={t.id}
                transaction={t}
                personId={person.id}
                first={i === 0}
                onPress={() => router.push(href("/transaction-form", { id: t.id, transaction: JSON.stringify(t) }))}
              />
            ))}
          </Card>
        )}
      </View>

      {canRecord && (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Button title="Rename" variant="secondary" icon={<Pencil size={15} color={colors.ink} />} onPress={() => setRenaming(true)} />
          {confirmRemove ? (
            <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.expenseSoft }}>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                {settled
                  ? `Remove ${person.name}? Their history stays in your transactions.`
                  : `Remove ${person.name}? ${describeBalance(person.name, balance, person.currency)}, which will no longer be tracked here.`}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Remove" variant="danger" loading={isRemoving} onPress={handleRemove} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Cancel" variant="secondary" disabled={isRemoving} onPress={() => setConfirmRemove(false)} />
                </View>
              </View>
            </View>
          ) : (
            <Button title="Remove person" variant="ghost" icon={<Trash2 size={15} color={colors.expense} />} onPress={() => setConfirmRemove(true)} />
          )}
        </View>
      )}

      <RenameSheet
        visible={renaming}
        familyId={family.id}
        person={person}
        onClose={() => setRenaming(false)}
        onSaved={() => {
          setRenaming(false);
          load();
        }}
      />
    </ScrollView>
  );
}

function HistoryRow({ transaction, personId, first, onPress }: { transaction: Transaction; personId: string; first: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const { effect, label, detail } = describeEntry(transaction, personId);
  const isExpense = transaction.type === "EXPENSE";
  const Icon = isExpense ? ShoppingBag : transaction.type === "TRANSFER" && transaction.transferToAccountId === personId ? ArrowUpRight : ArrowDownLeft;
  const date = new Date(transaction.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: first ? 0 : 1, borderTopColor: colors.line },
        pressed && { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} color={colors.inkMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }} numberOfLines={1}>
          {[date, detail].filter(Boolean).join(" · ")}
        </Text>
        {transaction.notes ? (
          <Text style={{ fontSize: 12, color: colors.inkMuted, marginTop: 2 }} numberOfLines={2}>
            {transaction.notes}
          </Text>
        ) : null}
      </View>
      {/* Signed by what it did to the tab: + they owe you more (or you owe less), − the reverse. */}
      <Text style={{ fontWeight: "800", fontVariant: ["tabular-nums"], color: effect > 0 ? colors.income : colors.expense }}>
        {`${effect > 0 ? "+" : "−"}${formatCurrency(Math.abs(effect), transaction.account.currency)}`}
      </Text>
    </Pressable>
  );
}

function RenameSheet({
  visible,
  familyId,
  person,
  onClose,
  onSaved,
}: {
  visible: boolean;
  familyId: string;
  person: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.patch(`/families/${familyId}/accounts/${person.id}`, { name: name.trim() });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to rename"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Rename"
      footer={<Button title="Save" loading={isSaving} disabled={!name.trim() || name.trim() === person.name} onPress={handleSave} />}
    >
      <View style={{ gap: 12 }}>
        <Field label="Name">
          <Input value={name} onChangeText={setName} autoCapitalize="words" autoFocus />
        </Field>
        <ErrorText>{error}</ErrorText>
      </View>
    </Sheet>
  );
}
