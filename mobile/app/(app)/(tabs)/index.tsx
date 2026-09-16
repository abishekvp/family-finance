import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../../../src/api/client";
import { useAuth } from "../../../src/context/AuthContext";
import { getErrorMessage } from "../../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors } from "../../../src/components/ui";

const ACCOUNT_TYPES = ["CASH", "BANK", "SAVINGS", "CREDIT_CARD", "DEBIT_CARD", "INVESTMENT", "LOAN"] as const;
type AccountType = (typeof ACCOUNT_TYPES)[number];

interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  owner: { id: string; name: string } | null;
}

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export default function Dashboard() {
  const { user } = useAuth();
  const family = user!.families[0];
  const [scope, setScope] = useState<"family" | "personal">("family");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddAccount, setShowAddAccount] = useState(false);

  const loadAccounts = useCallback(async () => {
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
      loadAccounts();
    }, [loadAccounts])
  );

  const visibleAccounts = scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id);
  const totalBalance = visibleAccounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <FlatList
      style={{ backgroundColor: "#F8FAFC" }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={isLoading} onRefresh={loadAccounts} />}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 12 }}>
          <View
            style={{
              flexDirection: "row",
              backgroundColor: "#E2E8F0",
              borderRadius: 10,
              padding: 4,
              alignSelf: "flex-start",
            }}
          >
            {(["family", "personal"] as const).map((s) => (
              <Pressable
                key={s}
                onPress={() => setScope(s)}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                  borderRadius: 8,
                  backgroundColor: scope === s ? colors.white : "transparent",
                }}
              >
                <Text style={{ fontWeight: "600", color: scope === s ? colors.brand700 : colors.slate500, textTransform: "capitalize" }}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>

          <Card>
            <Text style={{ color: colors.slate500, fontSize: 13 }}>
              {scope === "family" ? "Family" : "Your"} total balance
            </Text>
            <Text style={{ fontSize: 26, fontWeight: "700", marginTop: 4 }}>
              {formatCurrency(totalBalance, family.currency)}
            </Text>
            <View style={{ flexDirection: "row", marginTop: 12, gap: 24 }}>
              <View>
                <Text style={{ color: colors.slate500, fontSize: 12 }}>Accounts</Text>
                <Text style={{ fontWeight: "600" }}>{visibleAccounts.length}</Text>
              </View>
              <View>
                <Text style={{ color: colors.slate500, fontSize: 12 }}>Your role</Text>
                <Text style={{ fontWeight: "600", textTransform: "capitalize" }}>{family.role.toLowerCase()}</Text>
              </View>
            </View>
          </Card>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>Accounts</Text>
            <Button
              title={showAddAccount ? "Cancel" : "Add account"}
              variant="secondary"
              onPress={() => setShowAddAccount((v) => !v)}
            />
          </View>

          {showAddAccount && (
            <AddAccountForm
              familyId={family.id}
              onCreated={() => {
                setShowAddAccount(false);
                loadAccounts();
              }}
            />
          )}

          <ErrorText>{error}</ErrorText>

          {!isLoading && visibleAccounts.length === 0 && (
            <Text style={{ color: colors.slate400, fontSize: 13 }}>
              No accounts yet. Add a common family account or a private account of your own to get started.
            </Text>
          )}
        </View>
      }
      data={visibleAccounts}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Card style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ fontWeight: "600" }}>{item.name}</Text>
            <Text style={{ color: colors.slate500, fontSize: 12, marginTop: 2 }}>
              {item.type.replace("_", " ")} · {item.owner ? item.owner.name : "Shared (Common)"}
            </Text>
          </View>
          <Text style={{ fontWeight: "700", color: item.balance < 0 ? colors.red600 : colors.slate900 }}>
            {formatCurrency(item.balance, item.currency)}
          </Text>
        </Card>
      )}
    />
  );
}

function AddAccountForm({ familyId, onCreated }: { familyId: string; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("BANK");
  const [isCommon, setIsCommon] = useState(false);
  const [openingBalance, setOpeningBalance] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/accounts`, {
        name,
        type,
        isCommon,
        openingBalance: Number(openingBalance) || 0,
      });
      onCreated();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create account"));
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {ACCOUNT_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: type === t ? colors.brand600 : colors.slate50,
                  borderWidth: 1,
                  borderColor: type === t ? colors.brand600 : colors.slate200,
                }}
              >
                <Text style={{ color: type === t ? colors.white : colors.slate700, fontSize: 12, fontWeight: "600" }}>
                  {t.replace("_", " ")}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <View>
        <Label>Opening balance</Label>
        <Input keyboardType="decimal-pad" value={openingBalance} onChangeText={setOpeningBalance} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Label>Shared family (common) account</Label>
        <Switch value={isCommon} onValueChange={setIsCommon} />
      </View>

      <ErrorText>{error}</ErrorText>
      <Button title={isSubmitting ? "Adding..." : "Add account"} onPress={handleSubmit} disabled={isSubmitting || !name.trim()} />
    </Card>
  );
}
