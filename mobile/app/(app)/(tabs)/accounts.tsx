import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Banknote,
  ChevronRight,
  CreditCard,
  HandCoins,
  Landmark,
  LineChart,
  PiggyBank,
  Plus,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { api } from "../../../src/api/client";
import { fetchWithCache } from "../../../src/lib/cache";
import type { Account, AccountType } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { useTheme } from "../../../src/context/ThemeContext";
import { getErrorMessage } from "../../../src/api/errors";
import { Badge, Button, Card, CardHeader, Chip, EmptyState, ErrorText, Field, IconButton, Input, Money, ProgressBar, SkeletonRows, StatTile, Toggle } from "../../../src/components/ui";
import { formatCurrency, humanizeEnum, safePercent } from "../../../src/lib/format";
import { href } from "../../../src/lib/nav";
import { isPerson, lendingTotals } from "../../../src/lib/lending";

const ACCOUNT_TYPES: AccountType[] = ["CASH", "BANK", "SAVINGS", "CREDIT_CARD", "DEBIT_CARD", "INVESTMENT", "LOAN"];

const TYPE_ICONS: Record<AccountType, LucideIcon> = {
  CASH: Wallet,
  BANK: Landmark,
  SAVINGS: PiggyBank,
  CREDIT_CARD: CreditCard,
  DEBIT_CARD: CreditCard,
  INVESTMENT: LineChart,
  LOAN: Banknote,
  PERSON: HandCoins,
};

const GROUPS: { key: string; label: string; types: AccountType[] }[] = [
  { key: "cash", label: "Cash", types: ["CASH"] },
  { key: "accounts", label: "Accounts", types: ["BANK", "SAVINGS", "INVESTMENT"] },
  { key: "card", label: "Card", types: ["CREDIT_CARD", "DEBIT_CARD"] },
  { key: "loans", label: "Loans", types: ["LOAN"] },
];

export default function AccountsScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const router = useRouter();
  // Every account you see: yours and the family's, and those other members share with the family.
  const [allAccounts, setAccounts] = useState<Account[]>([]);
  const accounts = useMemo(() => allAccounts.filter((a) => !a.owner || a.owner.id === user!.id), [allAccounts, user]);
  const sharedAccounts = useMemo(() => allAccounts.filter((a) => a.owner && a.owner.id !== user!.id && !isPerson(a)), [allAccounts, user]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithCache<Account[]>(
        `/families/${family.id}/accounts`,
        { params: { include: "shared" } },
        (cached) => {
          setAccounts(cached.data);
          setIsLoading(false);
        },
        5 * 60 * 1000
      );
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

  // Friends you lend to or borrow from live on the Lend & borrow screen, not in the account list.
  const ownAccounts = useMemo(() => accounts.filter((a) => !isPerson(a)), [accounts]);
  const people = useMemo(() => accounts.filter(isPerson), [accounts]);
  const lending = lendingTotals(people);

  // The money in your own accounts. Lending moves it out of them (and getting it back moves it
  // in); what people owe you, or you owe them, is shown with Lend & borrow instead.
  const totals = useMemo(() => {
    const total = ownAccounts.reduce((sum, a) => sum + a.balance, 0);
    const liabilities = ownAccounts.reduce(
      (sum, a) => (a.type === "CREDIT_CARD" || a.type === "LOAN" ? sum + Math.max(0, -a.balance) : sum),
      0
    );
    return { total, liabilities, assets: total + liabilities };
  }, [ownAccounts]);

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <StatTile label="Assets" value={totals.assets} currency={family.currency} tone="income" loading={isLoading} />
        <StatTile label="Liabilities" value={totals.liabilities} currency={family.currency} tone="expense" loading={isLoading} />
        <StatTile label="Total" value={totals.total} currency={family.currency} tone="auto" loading={isLoading} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}>Your accounts</Text>
        <Button
          title={showAddForm ? "Cancel" : "Add account"}
          variant="secondary"
          size="sm"
          icon={!showAddForm ? <Plus size={14} color={colors.ink} /> : undefined}
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
        <SkeletonRows rows={4} />
      ) : ownAccounts.length === 0 ? (
        <EmptyState icon={<Wallet size={20} color={colors.brand600} />} title="No accounts yet" description="Add a personal account, or a family one everyone can use." />
      ) : (
        GROUPS.map((group) => {
          const groupAccounts = ownAccounts.filter((a) => group.types.includes(a.type));
          if (groupAccounts.length === 0) return null;
          const subtotal = groupAccounts.reduce((sum, a) => sum + a.balance, 0);
          return (
            <View key={group.key} style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2 }}>
                <Text style={{ fontSize: 12, fontWeight: "800", color: colors.inkSubtle, textTransform: "uppercase" }}>{group.label}</Text>
                <Money amount={subtotal} currency={family.currency} style={{ fontSize: 12, fontWeight: "800", color: colors.inkMuted }} />
              </View>
              <Card style={{ padding: 0 }}>
                {groupAccounts.map((account, i) => {
                  const Icon = TYPE_ICONS[account.type];
                  const creditLimit = account.creditLimit != null ? Number(account.creditLimit) : null;
                  const utilisation = account.type === "CREDIT_CARD" && creditLimit ? Math.max(0, -account.balance) : null;
                  return (
                    <View key={account.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
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
                        <View style={{ padding: 16, gap: 10 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <Pressable
                              onPress={() => {
                                setShowAddForm(false);
                                setEditingAccount(account);
                              }}
                              style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                            >
                              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
                                <Icon size={17} color={colors.brand600} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontWeight: "700", color: colors.ink }}>{account.name}</Text>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 }}>
                                  <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>{humanizeEnum(account.type)}</Text>
                                  <Badge tone={account.owner ? "neutral" : "brand"}>
                                    {!account.owner ? "Family" : account.sharedWithFamily ? "Shared" : "Personal"}
                                  </Badge>
                                </View>
                              </View>
                            </Pressable>
                            <Money amount={account.balance} currency={account.currency} tone={account.balance < 0 ? "expense" : undefined} style={{ fontWeight: "800" }} />
                            {confirmArchiveId === account.id ? (
                              <View style={{ flexDirection: "row", gap: 4 }}>
                                <Button title="Confirm" size="sm" variant="danger" onPress={() => handleArchive(account.id)} />
                              </View>
                            ) : (
                              <IconButton tone="danger" onPress={() => setConfirmArchiveId(account.id)}>
                                <Trash2 size={15} color={colors.inkSubtle} />
                              </IconButton>
                            )}
                          </View>
                          {utilisation !== null && creditLimit && (
                            <View>
                              <ProgressBar value={utilisation / creditLimit} tone={utilisation / creditLimit > 0.8 ? "expense" : "warn"} />
                              <Text style={{ fontSize: 10.5, color: colors.inkSubtle, marginTop: 4 }}>
                                {safePercent(utilisation, creditLimit).toFixed(0)}% of limit used
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </Card>
            </View>
          );
        })
      )}

      {!isLoading && sharedAccounts.length > 0 && (
        <View style={{ gap: 8 }}>
          <View style={{ paddingHorizontal: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: "800", color: colors.inkSubtle, textTransform: "uppercase" }}>Shared by family members</Text>
            <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 3 }}>
              Pick them in the Transactions filter to see the family's spending. Only they record on them; you can transfer money to them.
            </Text>
          </View>
          <Card style={{ padding: 0 }}>
            {sharedAccounts.map((account, i) => {
              const Icon = TYPE_ICONS[account.type];
              return (
                <View
                  key={account.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
                    <Icon size={17} color={colors.inkMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", color: colors.ink }}>{account.name}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}>
                      <Users size={12} color={colors.inkSubtle} />
                      <Text style={{ color: colors.inkSubtle, fontSize: 12 }} numberOfLines={1}>
                        {`${account.owner?.name ?? "A member"} · ${humanizeEnum(account.type)}`}
                      </Text>
                    </View>
                  </View>
                  <Money amount={account.balance} currency={account.currency} tone={account.balance < 0 ? "expense" : undefined} style={{ fontWeight: "800" }} />
                </View>
              );
            })}
          </Card>
        </View>
      )}

      {!isLoading && people.length > 0 && (
        <Pressable onPress={() => router.push(href("/lending"))}>
          {({ pressed }) => (
            <Card style={[{ flexDirection: "row", alignItems: "center", gap: 12 }, pressed && { opacity: 0.8 }]}>
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
                <HandCoins size={17} color={colors.brand600} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "700", color: colors.ink }}>Lend & borrow</Text>
                <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 3 }}>
                  {`${formatCurrency(lending.owedToYou, family.currency)} owed to you · ${formatCurrency(lending.youOwe, family.currency)} you owe`}
                </Text>
              </View>
              <ChevronRight size={17} color={colors.inkSubtle} />
            </Card>
          )}
        </Pressable>
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
  const { colors } = useTheme();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<AccountType>(initial?.type ?? "BANK");
  const [isCommon, setIsCommon] = useState(initial ? initial.owner === null : false);
  const [sharedWithFamily, setSharedWithFamily] = useState(initial?.sharedWithFamily ?? false);
  // Only a personal account can be shared for the family to see; a family account already is.
  const canShare = !isCommon;
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
          ...(isCommon !== (initial.owner === null) ? { isCommon } : {}),
          sharedWithFamily: canShare && sharedWithFamily,
          openingBalance: Number(openingBalance) || 0,
          creditLimit: creditLimit.trim() ? Number(creditLimit) : undefined,
        });
      } else {
        await api.post(`/families/${familyId}/accounts`, {
          name,
          type,
          isCommon,
          sharedWithFamily: canShare && sharedWithFamily,
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
    <Card style={{ gap: 14 }}>
      <Field label="Name">
        <Input value={name} onChangeText={setName} placeholder="Joint Checking" />
      </Field>

      <Field label="Type">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {ACCOUNT_TYPES.map((t) => {
            const Icon = TYPE_ICONS[t];
            return <Chip key={t} label={humanizeEnum(t)} selected={type === t} onPress={() => setType(t)} icon={<Icon size={12} color={type === t ? "#fff" : colors.inkMuted} />} />;
          })}
        </View>
      </Field>

      <Field label="Opening balance">
        <Input keyboardType="decimal-pad" value={openingBalance} onChangeText={setOpeningBalance} />
      </Field>

      <Field label="Credit limit" hint="Optional">
        <Input keyboardType="decimal-pad" value={creditLimit} onChangeText={setCreditLimit} placeholder="Optional" />
      </Field>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Family account</Text>
          <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
            {isCommon
              ? "Everyone in the family can see it and add to it. Only an admin can change it."
              : "Personal — only you add to it."}
          </Text>
        </View>
        <Toggle value={isCommon} onChange={setIsCommon} />
      </View>

      {canShare && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Share with family</Text>
            <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
              {sharedWithFamily
                ? "Family members can see it and its transactions, and send money to it. Only you add to it or change it."
                : "Only you can see it."}
            </Text>
          </View>
          <Toggle value={sharedWithFamily} onChange={setSharedWithFamily} />
        </View>
      )}

      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? "Save changes" : "Add account"} loading={isSubmitting} disabled={!name.trim()} onPress={handleSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
