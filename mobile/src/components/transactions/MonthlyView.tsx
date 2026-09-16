import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Account, Transaction } from "../../api/types";
import { colors } from "../../components/ui";
import { formatCurrency } from "../../lib/format";
import { MONTH_LABELS } from "../../lib/dateUtils";
import type { WeekStart } from "../../context/PrefsContext";
import { weekBucketsForMonth } from "../../lib/weeks";
import { CarryOverRow } from "./CarryOverRow";

interface Totals {
  income: number;
  expense: number;
}

function emptyTotals(): Totals {
  return { income: 0, expense: 0 };
}

function addTransaction(totals: Totals, t: Transaction) {
  if (t.type === "INCOME") totals.income += t.amount;
  else if (t.type === "EXPENSE") totals.expense += t.amount;
}

function TotalsRow({ label, totals, currency, bold }: { label: string; totals: Totals; currency: string; bold?: boolean }) {
  const net = totals.income - totals.expense;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
      }}
    >
      <Text style={{ flex: 1, fontWeight: bold ? "700" : "500", fontSize: bold ? 15 : 13 }}>{label}</Text>
      <View style={{ alignItems: "flex-end", minWidth: 84 }}>
        <Text style={{ color: colors.green600, fontSize: 11 }}>+{formatCurrency(totals.income, currency)}</Text>
        <Text style={{ color: colors.red600, fontSize: 11 }}>-{formatCurrency(totals.expense, currency)}</Text>
      </View>
      <Text
        style={{
          minWidth: 90,
          textAlign: "right",
          fontWeight: "700",
          color: net < 0 ? colors.red600 : colors.slate900,
        }}
      >
        {formatCurrency(net, currency)}
      </Text>
    </View>
  );
}

export function MonthlyView({
  transactions,
  accounts,
  familyId,
  currency,
  year,
  weekStart,
  carryOver,
  accountIds,
  onPressMonth,
}: {
  transactions: Transaction[];
  accounts: Account[];
  familyId: string;
  currency: string;
  year: number;
  weekStart: WeekStart;
  carryOver: boolean;
  accountIds: Set<string>;
  onPressMonth?: (month: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const byMonth = useMemo(() => {
    const arr: Totals[] = Array.from({ length: 12 }, () => emptyTotals());
    for (const t of transactions) {
      const d = new Date(t.date);
      if (d.getFullYear() !== year) continue;
      addTransaction(arr[d.getMonth()], t);
    }
    return arr;
  }, [transactions, year]);

  const weekTotalsByMonth = useMemo(() => {
    const map = new Map<number, { bucket: ReturnType<typeof weekBucketsForMonth>[number]; totals: Totals }[]>();
    for (const monthIdx of expanded) {
      const buckets = weekBucketsForMonth(new Date(year, monthIdx, 1), weekStart);
      const rows = buckets.map((bucket) => {
        const totals = emptyTotals();
        for (const t of transactions) {
          const d = new Date(t.date);
          if (d >= bucket.start && d <= bucket.end) addTransaction(totals, t);
        }
        return { bucket, totals };
      });
      map.set(monthIdx, rows);
    }
    return map;
  }, [expanded, transactions, weekStart, year]);

  if (transactions.length === 0) {
    if (carryOver) {
      return (
        <View style={{ paddingTop: 8 }}>
          <CarryOverRow
            familyId={familyId}
            periodStart={new Date(year, 0, 1)}
            accounts={accounts}
            accountIds={accountIds}
            currency={currency}
          />
        </View>
      );
    }
    return (
      <View style={{ paddingVertical: 40, alignItems: "center" }}>
        <Text style={{ color: colors.slate400, fontSize: 13 }}>No transactions in {year}.</Text>
      </View>
    );
  }

  function toggle(monthIdx: number) {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(monthIdx)) next.delete(monthIdx);
      else next.add(monthIdx);
      return next;
    });
    onPressMonth?.(monthIdx);
  }

  return (
    <View>
      {MONTH_LABELS.map((label, monthIdx) => {
        const totals = byMonth[monthIdx];
        const hasData = totals.income > 0 || totals.expense > 0;
        const isExpanded = expanded.has(monthIdx);
        return (
          <View key={label} style={{ borderTopWidth: 1, borderTopColor: colors.slate200 }}>
            <Pressable onPress={() => toggle(monthIdx)} disabled={!hasData}>
              <TotalsRow label={`${isExpanded ? "▾" : hasData ? "▸" : "  "} ${label}`} totals={totals} currency={currency} bold />
            </Pressable>
            {isExpanded && (
              <View style={{ paddingLeft: 16, paddingBottom: 8 }}>
                {(weekTotalsByMonth.get(monthIdx) ?? []).map((row, i) => (
                  <TotalsRow key={row.bucket.key} label={`Week ${i + 1}`} totals={row.totals} currency={currency} />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
