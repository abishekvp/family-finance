import { Fragment } from "react";
import { Text, View } from "react-native";
import type { Account, Transaction } from "../../api/types";
import { colors } from "../../components/ui";
import { formatCurrency } from "../../lib/format";
import { CarryOverRow } from "./CarryOverRow";
import { TransactionRow } from "./TransactionRow";

function dayKey(dateStr: string) {
  return dateStr.slice(0, 10);
}

function dayLabel(key: string) {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function DailyView({
  transactions,
  accounts,
  familyId,
  currency,
  periodStart,
  carryOver,
  accountIds,
  onPressTransaction,
}: {
  transactions: Transaction[];
  accounts: Account[];
  familyId: string;
  currency: string;
  periodStart: Date;
  carryOver: boolean;
  accountIds: Set<string>;
  onPressTransaction: (t: Transaction) => void;
}) {
  if (transactions.length === 0) {
    if (carryOver) {
      return (
        <View style={{ paddingTop: 8 }}>
          <CarryOverRow
            familyId={familyId}
            periodStart={periodStart}
            accounts={accounts}
            accountIds={accountIds}
            currency={currency}
          />
        </View>
      );
    }
    return (
      <View style={{ paddingVertical: 40, alignItems: "center" }}>
        <Text style={{ color: colors.slate400, fontSize: 13, textAlign: "center" }}>
          No transactions this month. Tap + to add your first one.
        </Text>
      </View>
    );
  }

  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const key = dayKey(t.date);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const orderedKeys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));

  return (
    <View>
      {orderedKeys.map((key) => {
        const dayTransactions = groups.get(key)!;
        let income = 0;
        let expense = 0;
        for (const t of dayTransactions) {
          if (t.type === "INCOME") income += t.amount;
          else if (t.type === "EXPENSE") expense += t.amount;
        }
        return (
          <Fragment key={key}>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 16,
                marginBottom: 4,
              }}
            >
              <Text style={{ fontWeight: "700", fontSize: 13, color: colors.slate700 }}>{dayLabel(key)}</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {income > 0 && (
                  <Text style={{ color: colors.green600, fontSize: 12, fontWeight: "600" }}>
                    +{formatCurrency(income, currency)}
                  </Text>
                )}
                {expense > 0 && (
                  <Text style={{ color: colors.red600, fontSize: 12, fontWeight: "600" }}>
                    -{formatCurrency(expense, currency)}
                  </Text>
                )}
              </View>
            </View>
            {dayTransactions.map((t) => (
              <TransactionRow key={t.id} transaction={t} onPress={() => onPressTransaction(t)} />
            ))}
          </Fragment>
        );
      })}
    </View>
  );
}
