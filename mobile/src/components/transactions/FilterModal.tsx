import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { Account, Transaction } from "../../api/types";
import { Button, colors } from "../../components/ui";
import { formatCurrency } from "../../lib/format";

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(15,23,42,0.4)" }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            marginTop: "auto",
            backgroundColor: colors.white,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            maxHeight: "75%",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>Filter accounts</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={{ fontSize: 20, color: colors.slate400 }}>✕</Text>
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            <Button title="Select all" variant="secondary" onPress={() => onChange(null)} />
            <Button title="Clear all" variant="secondary" onPress={() => onChange(new Set())} />
          </View>

          {accounts.length === 0 ? (
            <Text style={{ color: colors.slate400, fontSize: 13 }}>No accounts to filter yet.</Text>
          ) : (
            <ScrollView>
              {accounts.map((account) => {
                const { income, expense } = totalsFor(account.id);
                const selected = isSelected(account.id);
                return (
                  <Pressable
                    key={account.id}
                    onPress={() => toggle(account.id)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 10,
                      borderTopWidth: 1,
                      borderTopColor: colors.slate200,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 5,
                          borderWidth: 2,
                          borderColor: selected ? colors.brand600 : colors.slate200,
                          backgroundColor: selected ? colors.brand600 : colors.white,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {selected && <Text style={{ color: colors.white, fontSize: 12, fontWeight: "700" }}>✓</Text>}
                      </View>
                      <Text style={{ fontSize: 14, flexShrink: 1 }} numberOfLines={1}>
                        {account.name}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: colors.green600, fontSize: 11 }}>
                        +{formatCurrency(income, account.currency || currency)}
                      </Text>
                      <Text style={{ color: colors.red600, fontSize: 11 }}>
                        -{formatCurrency(expense, account.currency || currency)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
