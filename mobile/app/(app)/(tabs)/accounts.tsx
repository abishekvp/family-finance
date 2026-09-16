import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../../../src/api/client";
import type { Account, AccountType } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { getErrorMessage } from "../../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors, pillStyle, pillTextStyle } from "../../../src/components/ui";
import { formatCurrency } from "../../../src/lib/format";

const ACCOUNT_TYPES: AccountType[] = ["CASH", "BANK", "SAVINGS", "CREDIT_CARD", "DEBIT_CARD", "INVESTMENT", "LOAN"];

const GROUPS: { key: string; label: string; types: AccountType[] }[] = [
  { key: "cash", label: "Cash", types: ["CASH"] },
  { key: "accounts", label: "Accounts", types: ["BANK", "SAVINGS", "INVESTMENT"] },
  { key: "card", label: "Card", types: ["CREDIT_CARD", "DEBIT_CARD"] },
  { key: "loans", label: "Loans", types: ["LOAN"] },
];

export default function AccountsScreen() {
  const { user } = useAuth();
  const family = user!.families[0];
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Account[]>(`/families/${family.id}/accounts`);
      setAccounts(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load accounts"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  async function handleArchive(id: string) {
    setArchiveError(null);
    try {
      await api.delete(`/families/${family.id}/accounts/${id}`);
      setConfirmArchiveId(null);
      await load();
    } catch (err) {
      setArchiveError(getErrorMessage(err, "Unable to archive account"));
    }
  }

  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  const liabilities = accounts.reduce(
    (sum, a) => (a.type === "CREDIT_CARD" || a.type === "LOAN" ? sum + Math.max(0, -a.balance) : sum),
    0
  );
  const assets = total + liabilities;

  return (
    <ScrollView style={{ backgroundColor: colors.slate50 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <View>
            <Text style={{ color: colors.slate500, fontSize: 12 }}>Assets</Text>
            <Text style={{ fontWeight: "700", fontSize: 17, color: colors.green600 }}>
              {formatCurrency(assets, family.currency)}
            </Text>
          </View>
          <View>
            <Text style={{ color: colors.slate500, fontSize: 12 }}>Liabilities</Text>
            <Text style={{ fontWeight: "700", fontSize: 17, color: colors.red600 }}>
              {formatCurrency(liabilities, family.currency)}
            </Text>
          </View>
          <View>
            <Text style={{ color: colors.slate500, fontSize: 12 }}>Total</Text>
            <Text style={{ fontWeight: "700", fontSize: 17 }}>{formatCurrency(total, family.currency)}</Text>
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 17, fontWeight: "700" }}>Accounts</Text>
        <Button
          title={showAddForm ? "Cancel" : "Add account"}
          variant="secondary"
          onPress={() => {
            setEditingAccount(null);
            setShowAddForm((v) => !v);
          }}
        />
      </View>

      {showAddForm && (
        <AccountForm
          familyId={family.id}
          onDone={() => {
            setShowAddForm(false);
            load();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <ErrorText>{error}</ErrorText>
      <ErrorText>{archiveError}</ErrorText>

      {isLoading ? (
        <ActivityIndicator color={colors.brand600} size="large" style={{ marginTop: 40 }} />
      ) : accounts.length === 0 ? (
        <Card>
          <Text style={{ color: colors.slate400, fontSize: 13, textAlign: "center" }}>
            No accounts yet. Add a common family account or a private one of your own.
          </Text>
        </Card>
      ) : (
        GROUPS.map((group) => {
          const groupAccounts = accounts.filter((a) => group.types.includes(a.type));
          if (groupAccounts.length === 0) return null;
          const subtotal = groupAccounts.reduce((sum, a) => sum + a.balance, 0);
          return (
            <View key={group.key} style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.slate500, textTransform: "uppercase" }}>
                  {group.label}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.slate500 }}>
                  {formatCurrency(subtotal, family.currency)}
                </Text>
              </View>
              <Card style={{ padding: 0 }}>
                {groupAccounts.map((account, i) => (
                  <View key={account.id}>
                    {editingAccount?.id === account.id ? (
                      <View style={{ padding: 16 }}>
                        <AccountForm
                          familyId={family.id}
                          initial={account}
                          onDone={() => {
                            setEditingAccount(null);
                            load();
                          }}
                          onCancel={() => setEditingAccount(null)}
                        />
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => {
                          setShowAddForm(false);
                          setEditingAccount(account);
                        }}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: 16,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: colors.slate200,
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={{ fontWeight: "600" }}>{account.name}</Text>
                          <Text style={{ color: colors.slate500, fontSize: 12, marginTop: 2 }}>
                            {account.type.replace("_", " ")} · {account.owner ? account.owner.name : "Shared"}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 6 }}>
                          <Text style={{ fontWeight: "700", color: account.balance < 0 ? colors.red600 : colors.slate900 }}>
                            {formatCurrency(account.balance, account.currency)}
                          </Text>
                          {confirmArchiveId === account.id ? (
                            <View style={{ flexDirection: "row", gap: 12 }}>
                              <Pressable onPress={() => handleArchive(account.id)} hitSlop={8}>
                                <Text style={{ color: colors.red600, fontSize: 11, fontWeight: "700" }}>Confirm</Text>
                              </Pressable>
                              <Pressable onPress={() => setConfirmArchiveId(null)} hitSlop={8}>
                                <Text style={{ color: colors.slate500, fontSize: 11, fontWeight: "600" }}>Cancel</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <Pressable onPress={() => setConfirmArchiveId(account.id)} hitSlop={8}>
                              <Text style={{ color: colors.slate400, fontSize: 11, fontWeight: "600" }}>Archive</Text>
                            </Pressable>
                          )}
                        </View>
                      </Pressable>
                    )}
                  </View>
                ))}
              </Card>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function AccountForm({
  familyId,
  initial,
  onDone,
  onCancel,
}: {
  familyId: string;
  initial?: Account;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AccountType>(initial?.type ?? "BANK");
  const [isCommon, setIsCommon] = useState(initial ? initial.owner === null : false);
  const [openingBalance, setOpeningBalance] = useState(String(initial?.openingBalance ?? 0));
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit != null ? String(initial.creditLimit) : "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && initial) {
        await api.patch(`/families/${familyId}/accounts/${initial.id}`, {
          name,
          type,
          openingBalance: Number(openingBalance) || 0,
          creditLimit: creditLimit.trim() ? Number(creditLimit) : undefined,
        });
      } else {
        await api.post(`/families/${familyId}/accounts`, {
          name,
          type,
          isCommon,
          openingBalance: Number(openingBalance) || 0,
          creditLimit: creditLimit.trim() ? Number(creditLimit) : undefined,
        });
      }
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update account" : "Unable to create account"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Label>Name</Label>
        <Input value={name} onChangeText={setName} placeholder="Joint Checking" />
      </View>

      <View>
        <Label>Type</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ACCOUNT_TYPES.map((t) => (
            <Pressable key={t} onPress={() => setType(t)} style={pillStyle(type === t)}>
              <Text style={pillTextStyle(type === t)}>{t.replace("_", " ")}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View>
        <Label>Opening balance</Label>
        <Input keyboardType="decimal-pad" value={openingBalance} onChangeText={setOpeningBalance} />
      </View>

      <View>
        <Label>Credit limit (optional)</Label>
        <Input keyboardType="decimal-pad" value={creditLimit} onChangeText={setCreditLimit} placeholder="Optional" />
      </View>

      {!isEdit && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Label>Shared family (common) account</Label>
          <Pressable
            onPress={() => setIsCommon((v) => !v)}
            style={[pillStyle(isCommon), { paddingHorizontal: 16 }]}
          >
            <Text style={pillTextStyle(isCommon)}>{isCommon ? "Shared" : "Private"}</Text>
          </Pressable>
        </View>
      )}

      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={isSubmitting ? "Saving..." : isEdit ? "Save changes" : "Add account"}
            onPress={handleSubmit}
            disabled={isSubmitting || !name.trim()}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
