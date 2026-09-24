import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CalendarX } from "lucide-react-native";
import type { Account, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { EmptyState, Money } from "../ui";
import type { WeekStart } from "../../context/PrefsContext";
import { localDateInput, weekStartsOn } from "../../lib/dateUtils";
import { CarryOverRow } from "./CarryOverRow";
import { TransactionRow } from "./TransactionRow";

const WEEKDAY_LABELS_SUN = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_LABELS_MON = ["M", "T", "W", "T", "F", "S", "S"];

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function CalendarView({
  transactions,
  accounts,
  familyId,
  currency,
  anchorMonth,
  weekStart,
  carryOver,
  accountIds,
  onPressTransaction,
}: {
  transactions: Transaction[];
  accounts: Account[];
  familyId: string;
  currency: string;
  anchorMonth: Date;
  weekStart: WeekStart;
  carryOver: boolean;
  accountIds: Set<string>;
  onPressTransaction: (t: Transaction) => void;
}) {
  const { colors } = useTheme();
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const totalsByDay = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    for (const t of transactions) {
      const key = localDateInput(new Date(t.date));
      const entry = map.get(key) ?? { income: 0, expense: 0 };
      if (t.type === "INCOME") entry.income += t.amount;
      else if (t.type === "EXPENSE") entry.expense += t.amount;
      map.set(key, entry);
    }
    return map;
  }, [transactions]);

  const year = anchorMonth.getFullYear();
  const month = anchorMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const wsOn = weekStartsOn(weekStart);
  const firstDow = new Date(year, month, 1).getDay();
  const leadingBlanks = (firstDow - wsOn + 7) % 7;
  const weekdayLabels = wsOn === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;

  const cells: { day: number | null; key: string | null }[] = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push({ day: null, key: null });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, key: dayKey(new Date(year, month, d)) });
  while (cells.length % 7 !== 0) cells.push({ day: null, key: null });

  const todayKey = dayKey(new Date());
  const selectedTransactions = selectedDay
    ? transactions.filter((t) => localDateInput(new Date(t.date)) === selectedDay).sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  return (
    <View>
      <View style={{ flexDirection: "row" }}>
        {weekdayLabels.map((label, i) => (
          <View key={i} style={{ flex: 1, alignItems: "center", paddingVertical: 4 }}>
            <Text style={{ fontSize: 11, fontWeight: "800", color: colors.inkSubtle }}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((cell, i) => {
          if (cell.day === null || cell.key === null) {
            return <View key={i} style={{ width: "14.2857%", aspectRatio: 0.85 }} />;
          }
          const totals = totalsByDay.get(cell.key);
          const isToday = cell.key === todayKey;
          const isSelected = cell.key === selectedDay;
          return (
            <Pressable key={i} onPress={() => setSelectedDay((cur) => (cur === cell.key ? null : cell.key))} style={{ width: "14.2857%", aspectRatio: 0.85, padding: 2 }}>
              <View
                style={{
                  flex: 1,
                  borderRadius: 10,
                  alignItems: "center",
                  paddingTop: 4,
                  backgroundColor: isSelected ? colors.brand600 : "transparent",
                  borderWidth: isToday && !isSelected ? 1.5 : 0,
                  borderColor: colors.brand500,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: isToday ? "800" : "600", color: isSelected ? colors.white : colors.ink }}>
                  {cell.day}
                </Text>
                {totals && totals.income > 0 && (
                  <Text style={{ fontSize: 8, fontWeight: "700", color: isSelected ? colors.white : colors.income }} numberOfLines={1}>
                    +{Math.round(totals.income)}
                  </Text>
                )}
                {totals && totals.expense > 0 && (
                  <Text style={{ fontSize: 8, fontWeight: "700", color: isSelected ? "rgba(255,255,255,0.85)" : colors.expense }} numberOfLines={1}>
                    −{Math.round(totals.expense)}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      {transactions.length === 0 && carryOver && (
        <View style={{ marginTop: 12 }}>
          <CarryOverRow familyId={familyId} periodStart={new Date(year, month, 1)} accounts={accounts} accountIds={accountIds} currency={currency} />
        </View>
      )}
      {transactions.length === 0 && !carryOver && (
        <View style={{ marginTop: 12 }}>
          <EmptyState icon={<CalendarX size={20} color={colors.brand600} />} title="No transactions this month" />
        </View>
      )}

      {selectedDay && (
        <View style={{ marginTop: 16, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
          <Text style={{ fontWeight: "800", fontSize: 12, color: colors.inkMuted, marginBottom: 4, textTransform: "uppercase" }}>
            {new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </Text>
          {selectedTransactions.length === 0 ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13, paddingVertical: 8 }}>No transactions on this day.</Text>
          ) : (
            selectedTransactions.map((t) => <TransactionRow key={t.id} transaction={t} onPress={() => onPressTransaction(t)} />)
          )}
        </View>
      )}
    </View>
  );
}
