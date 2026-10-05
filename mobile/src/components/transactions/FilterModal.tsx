import { ScrollView, Text, View } from "react-native";
import type { Account, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { Button, Checkbox, Money, Sheet } from "../ui";
import { totalsContribution } from "../../lib/transactionTotals";

/**
 * Lets the user check which accounts to include; each row shows that account's income/expense
 * total for the currently-viewed period as context. Filtering itself happens client-side in the
 * parent screen over the already-fetched transaction set.
 */
export function FilterModal({
  visible,
  accounts,
  periodTransactions,
  selectedAccountIds,
  onChange,
  currency,
  onClose,
}: {
  visible: boolean;
  accounts: Account[];
  periodTransactions: Transaction[];
  selectedAccountIds: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  currency: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const isSelected = (id: string) => selectedAccountIds === null || selectedAccountIds.has(id);

  function toggle(id: string) {
    const current = selectedAccountIds ?? new Set(accounts.map((a) => a.id));
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next.size === accounts.length ? null : next);
  }

  function totalsFor(accountId: string) {
    let income = 0;
    let expense = 0;
    for (const t of periodTransactions) {
      if (t.accountId !== accountId) continue;
      if (t.type === "INCOME") income += t.amount;
      else if (t.type === "EXPENSE") expense += t.amount;
    }
    return { income, expense };
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter accounts">
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Button title="Select all" variant="secondary" size="sm" onPress={() => onChange(null)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Clear all" variant="secondary" size="sm" onPress={() => onChange(new Set())} />
        </View>
      </View>

      {accounts.length === 0 ? (
        <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No accounts to filter yet.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 360 }}>
          {accounts.map((account) => {
            const { income, expense } = totalsFor(account.id);
            const selected = isSelected(account.id);
            return (
              <View
                key={account.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderTopColor: colors.line,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                  <Checkbox checked={selected} onChange={() => toggle(account.id)} />
                  <Text style={{ fontSize: 14, flexShrink: 1, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>
                    {account.name}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Money amount={income} currency={account.currency || currency} tone="income" signed style={{ fontSize: 11 }} />
                  <Money amount={-expense} currency={account.currency || currency} tone="expense" signed style={{ fontSize: 11 }} />
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}
