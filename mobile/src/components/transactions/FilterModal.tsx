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
  sharedAccounts = [],
  periodTransactions,
  selectedAccountIds,
  onChange,
  currency,
  onClose,
}: {
  visible: boolean;
  /** Your accounts; all of them selected is the default (null). */
  accounts: Account[];
  /** Accounts family members share with the family: picked to see how the family's money moves. */
  sharedAccounts?: Account[];
  periodTransactions: Transaction[];
  selectedAccountIds: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
  currency: string;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  // The default (null) is all of your own accounts and none shared by others.
  const isSelected = (id: string) => (selectedAccountIds === null ? accounts.some((a) => a.id === id) : selectedAccountIds.has(id));

  function toggle(id: string) {
    const current = selectedAccountIds ?? new Set(accounts.map((a) => a.id));
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const isDefault = next.size === accounts.length && accounts.every((a) => next.has(a.id));
    onChange(isDefault ? null : next);
  }

  function row(account: Account, owner?: string) {
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
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 14, color: colors.ink, fontWeight: "600" }} numberOfLines={1}>
              {account.name}
            </Text>
            {owner ? (
              <Text style={{ fontSize: 11, color: colors.inkSubtle }} numberOfLines={1}>
                {owner}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Money amount={income} currency={account.currency || currency} tone="income" signed style={{ fontSize: 11 }} />
          <Money amount={-expense} currency={account.currency || currency} tone="expense" signed style={{ fontSize: 11 }} />
        </View>
      </View>
    );
  }

  // Counted the way every total is: after refunds, without family transfers or uncounted entries.
  function totalsFor(accountId: string) {
    let income = 0;
    let expense = 0;
    for (const t of periodTransactions) {
      if (t.accountId !== accountId) continue;
      const counted = totalsContribution(t);
      income += counted.income;
      expense += counted.expense;
    }
    return { income, expense };
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter accounts">
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Button title={sharedAccounts.length > 0 ? "All yours" : "Select all"} variant="secondary" size="sm" onPress={() => onChange(null)} />
        </View>
        {sharedAccounts.length > 0 && (
          <View style={{ flex: 1 }}>
            <Button
              title="Whole family"
              variant="secondary"
              size="sm"
              onPress={() => onChange(new Set([...accounts, ...sharedAccounts].map((a) => a.id)))}
            />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Button title="Clear all" variant="secondary" size="sm" onPress={() => onChange(new Set())} />
        </View>
      </View>

      {accounts.length === 0 && sharedAccounts.length === 0 ? (
        <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No accounts to filter yet.</Text>
      ) : (
        <ScrollView style={{ maxHeight: 420 }}>
          {accounts.map((account) => row(account))}
          {sharedAccounts.length > 0 && (
            <Text style={{ fontSize: 12, fontWeight: "700", color: colors.inkMuted, marginTop: 14, marginBottom: 6 }}>
              Shared by family members
            </Text>
          )}
          {sharedAccounts.map((account) => row(account, account.owner?.name))}
        </ScrollView>
      )}
    </Sheet>
  );
}
