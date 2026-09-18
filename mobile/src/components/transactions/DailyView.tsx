import { Fragment } from "react";
import { Text, View } from "react-native";
import { CalendarX } from "lucide-react-native";
import type { Account, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { EmptyState, Money } from "../ui";
import { CarryOverRow } from "./CarryOverRow";
import { TransactionRow } from "./TransactionRow";

function dayKey(dateStr: string) {
  return dateStr.slice(0, 10);
}

function dayLabel(key: string) {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
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
  const { colors } = useTheme();

  if (transactions.length === 0) {
    if (carryOver) {
      return <CarryOverRow familyId={familyId} periodStart={periodStart} accounts={accounts} accountIds={accountIds} currency={currency} />;
    }
    return (
      <EmptyState
        icon={<CalendarX size={20} color={colors.brand600} />}
        title="No transactions this month"
        description="Tap the + button to add your first one."
      />
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
    <View style={{ gap: 4 }}>
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
                marginTop: 14,
                marginBottom: 2,
              }}
            >
              <Text style={{ fontWeight: "800", fontSize: 12, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: 0.3 }}>
                {dayLabel(key)}
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {income > 0 && <Money amount={income} currency={currency} tone="income" signed style={{ fontSize: 12, fontWeight: "700" }} />}
                {expense > 0 && <Money amount={-expense} currency={currency} tone="expense" signed style={{ fontSize: 12, fontWeight: "700" }} />}
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
