import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronRight, TrendingUp } from "lucide-react-native";
import type { Account, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { EmptyState, Money } from "../ui";
import { MONTH_LABELS } from "../../lib/dateUtils";
import type { WeekStart } from "../../context/PrefsContext";
import { weekBucketsForMonth } from "../../lib/weeks";
import { CarryOverRow } from "./CarryOverRow";
import { totalsContribution } from "../../lib/transactionTotals";

interface Totals {
  income: number;
  expense: number;
}

function emptyTotals(): Totals {
  return { income: 0, expense: 0 };
}

function addTransaction(totals: Totals, t: Transaction) {
  {
    const counted = totalsContribution(t);
    totals.income += counted.income;
    totals.expense += counted.expense;
  }
}

function TotalsRow({ label, totals, currency, bold, colors }: { label: string; totals: Totals; currency: string; bold?: boolean; colors: ReturnType<typeof useTheme>["colors"] }) {
  const net = totals.income - totals.expense;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8 }}>
      <Text style={{ flex: 1, fontWeight: bold ? "800" : "600", fontSize: bold ? 14 : 12.5, color: colors.ink }} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ alignItems: "flex-end", minWidth: 76 }}>
        <Money amount={totals.income} currency={currency} tone="income" signed style={{ fontSize: 10.5 }} />
        <Money amount={-totals.expense} currency={currency} tone="expense" signed style={{ fontSize: 10.5 }} />
      </View>
      <Money amount={net} currency={currency} tone="auto" style={{ minWidth: 80, textAlign: "right", fontWeight: "800", fontSize: 12.5 }} />
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
  const { colors } = useTheme();
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

  const peak = useMemo(() => Math.max(1, ...byMonth.map((m) => Math.max(m.income, m.expense))), [byMonth]);

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
      return <CarryOverRow familyId={familyId} periodStart={new Date(year, 0, 1)} accounts={accounts} accountIds={accountIds} currency={currency} />;
    }
    return <EmptyState icon={<TrendingUp size={20} color={colors.brand600} />} title={`No transactions in ${year}`} />;
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
          <View key={label} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
            <Pressable onPress={() => toggle(monthIdx)} disabled={!hasData} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {hasData ? (
                isExpanded ? (
                  <ChevronDown size={14} color={colors.inkSubtle} />
                ) : (
                  <ChevronRight size={14} color={colors.inkSubtle} />
                )
              ) : (
                <View style={{ width: 14 }} />
              )}
              <View style={{ flex: 1 }}>
                <TotalsRow label={label} totals={totals} currency={currency} bold colors={colors} />
              </View>
            </Pressable>
            {hasData && (
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.surfaceSunken, marginBottom: 8, overflow: "hidden" }}>
                <View style={{ width: `${(totals.expense / peak) * 100}%`, height: "100%", backgroundColor: colors.expense }} />
              </View>
            )}
            {isExpanded && (
              <View style={{ paddingLeft: 20, paddingBottom: 8 }}>
                {(weekTotalsByMonth.get(monthIdx) ?? []).map((row, i) => (
                  <TotalsRow key={row.bucket.key} label={`Week ${i + 1}`} totals={row.totals} currency={currency} colors={colors} />
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}
