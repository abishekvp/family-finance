import { Fragment } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { CalendarX } from "lucide-react-native";
import type { Account, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { EmptyState, Money } from "../ui";
import { CarryOverRow } from "./CarryOverRow";
import { TransactionRow } from "./TransactionRow";
import { localDateInput } from "../../lib/dateUtils";

// The local day, not dateStr.slice(0, 10): that is the UTC day, which files anything from local
// midnight until the UTC offset (5:30 AM in India) under the previous day.
function dayKey(dateStr: string) {
  return localDateInput(new Date(dateStr));
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
  limit = Infinity,
}: {
  transactions: Transaction[];
  accounts: Account[];
  familyId: string;
  currency: string;
  periodStart: Date;
  carryOver: boolean;
  accountIds: Set<string>;
  onPressTransaction: (t: Transaction) => void;
  /** Draw only the newest this many rows (the rest follow as the list is scrolled). Day totals stay whole. */
  limit?: number;
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

  // Whole days' totals, but rows only up to the limit.
  let budget = limit;
  const shownKeys: string[] = [];
  for (const key of orderedKeys) {
    if (budget <= 0) break;
    shownKeys.push(key);
    budget -= groups.get(key)!.length;
  }
  const hasMore = shownKeys.length < orderedKeys.length || budget < 0;

  return (
    <View style={{ gap: 4 }}>
      {shownKeys.map((key, index) => {
        const dayTransactions = groups.get(key)!;
        const isLastShown = index === shownKeys.length - 1;
        const shownRows = isLastShown && budget < 0 ? dayTransactions.slice(0, dayTransactions.length + budget) : dayTransactions;
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
            {shownRows.map((t) => (
              <TransactionRow key={t.id} transaction={t} onPress={() => onPressTransaction(t)} />
            ))}
          </Fragment>
        );
      })}
      {hasMore && <ActivityIndicator color={colors.brand600} style={{ paddingVertical: 16 }} />}
    </View>
  );
}
