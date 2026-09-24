import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ChevronLeft, ChevronRight, PieChart as PieChartIcon } from "lucide-react-native";
import { api } from "../../../src/api/client";
import type { Budget, Transaction } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { useTheme } from "../../../src/context/ThemeContext";
import { getErrorMessage } from "../../../src/api/errors";
import { Card, Dot, EmptyState, ErrorText, IconButton, Money, Segmented, SkeletonRows } from "../../../src/components/ui";
import { safePercent } from "../../../src/lib/format";
import { monthRange, yearRange } from "../../../src/lib/dateUtils";
import { CHART_SWATCHES } from "../../../src/theme";
import { DonutChart } from "../../../src/components/DonutChart";

type TypeFilter = "EXPENSE" | "INCOME";
type PeriodMode = "monthly" | "yearly";

interface CategorySlice {
  key: string;
  name: string;
  color: string;
  amount: number;
}

export default function Stats() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("EXPENSE");
  const [periodMode, setPeriodMode] = useState<PeriodMode>("monthly");
  const [anchor, setAnchor] = useState(() => new Date());
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  // The period's budgets, for "overall money used" against what was planned.
  const [budgetTotal, setBudgetTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { from, to } = periodMode === "monthly" ? monthRange(anchor) : yearRange(anchor.getFullYear());
    try {
      const budgetParams =
        periodMode === "monthly"
          ? { year: anchor.getFullYear(), month: anchor.getMonth() + 1 }
          : { year: anchor.getFullYear(), period: "ANNUAL" };
      const [res, budgetsRes] = await Promise.all([
        api.get<Transaction[]>(`/families/${family.id}/transactions`, {
          params: { type: typeFilter, from: from.toISOString(), to: to.toISOString(), limit: 1000 },
        }),
        typeFilter === "EXPENSE"
          ? api.get<Budget[]>(`/families/${family.id}/budgets`, { params: budgetParams })
          : Promise.resolve({ data: [] as Budget[] }),
      ]);
      setTransactions(res.data);
      setBudgetTotal(budgetsRes.data.reduce((sum, b) => sum + b.amount, 0));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load stats"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id, typeFilter, periodMode, anchor]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  const slices = useMemo<CategorySlice[]>(() => {
    const map = new Map<string, CategorySlice>();
    for (const t of transactions) {
      const key = t.category?.id ?? "uncategorized";
      const existing = map.get(key);
      if (existing) {
        existing.amount += t.amount;
      } else {
        map.set(key, { key, name: t.category?.name ?? "Uncategorized", color: t.category?.color ?? colors.inkSubtle, amount: t.amount });
      }
    }
    // Categories left on the default colour get distinct chart colours, so slices stay apart.
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .map((s, i) => ({ ...s, color: s.color === "#6366F1" || !s.color ? CHART_SWATCHES[i % CHART_SWATCHES.length] : s.color }));
  }, [transactions, colors]);

  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  const periodLabel = periodMode === "monthly" ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" }) : String(anchor.getFullYear());

  function shift(delta: number) {
    setAnchor((d) => (periodMode === "monthly" ? new Date(d.getFullYear(), d.getMonth() + delta, 1) : new Date(d.getFullYear() + delta, 0, 1)));
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <Segmented
          options={[
            { value: "EXPENSE", label: "Expenses" },
            { value: "INCOME", label: "Income" },
          ]}
          value={typeFilter}
          onChange={setTypeFilter}
        />
        <Segmented
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "yearly", label: "Yearly" },
          ]}
          value={periodMode}
          onChange={setPeriodMode}
        />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <IconButton onPress={() => shift(-1)}>
          <ChevronLeft size={19} color={colors.inkMuted} />
        </IconButton>
        <Text style={{ fontWeight: "800", fontSize: 15, color: colors.ink, minWidth: 140, textAlign: "center" }}>{periodLabel}</Text>
        <IconButton onPress={() => shift(1)}>
          <ChevronRight size={19} color={colors.inkMuted} />
        </IconButton>
      </View>

      <ErrorText>{error}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={5} />
      ) : slices.length === 0 ? (
        <EmptyState
          icon={<PieChartIcon size={20} color={colors.brand600} />}
          title={`No ${typeFilter === "EXPENSE" ? "expenses" : "income"} yet`}
          description={`Add a transaction to see it broken down by category for this ${periodMode === "monthly" ? "month" : "year"}.`}
        />
      ) : (
        <>
          <MoneyUsed
            slices={slices}
            total={total}
            budgetTotal={typeFilter === "EXPENSE" ? budgetTotal : 0}
            currency={family.currency}
            title={typeFilter === "EXPENSE" ? "Overall money used" : "Overall money earned"}
            hint={typeFilter === "EXPENSE" ? "Set budgets to see this against what you planned." : "Each colour is a category."}
          />

          <Card style={{ alignItems: "center", gap: 16, paddingVertical: 22 }}>
            <DonutChart slices={slices.map((s) => ({ key: s.key, color: s.color, value: s.amount }))}>
              <Text style={{ color: colors.inkMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
                {typeFilter === "EXPENSE" ? "Spent" : "Earned"}
              </Text>
              <Money amount={total} currency={family.currency} compact style={{ fontSize: 20, fontWeight: "900", marginTop: 2 }} />
            </DonutChart>
            {/* The biggest slices, named: the full breakdown follows below. */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
              {slices.slice(0, 4).map((s) => (
                <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Dot color={s.color} size={9} />
                  <Text style={{ fontSize: 12, color: colors.inkMuted, fontWeight: "600" }}>
                    {s.name} {safePercent(s.amount, total).toFixed(0)}%
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Card style={{ gap: 14 }}>
            {slices.map((s) => {
              const pct = safePercent(s.amount, total);
              const color = s.color;
              return (
                <View key={s.key} style={{ gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Dot color={color} />
                    <Text style={{ flex: 1, fontSize: 13.5, fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.inkSubtle, fontWeight: "600" }}>{pct.toFixed(0)}%</Text>
                    <Money amount={s.amount} currency={family.currency} style={{ fontSize: 13, fontWeight: "800" }} />
                  </View>
                  {/* In the category's colour, matching its slice and segment above. */}
                  <View style={{ height: 6, borderRadius: 999, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
                    <View style={{ width: `${pct}%`, height: "100%", borderRadius: 999, backgroundColor: color }} />
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

/**
 * One bar of everything used in the period, a coloured segment per category. With a budget the bar
 * is the budget: the empty end is what's left, and spending past it fills the whole bar.
 */
function MoneyUsed({
  slices,
  total,
  budgetTotal,
  currency,
  title,
  hint,
}: {
  slices: CategorySlice[];
  total: number;
  budgetTotal: number;
  currency: string;
  title: string;
  /** Shown under the bar when there's no budget to measure against. */
  hint: string;
}) {
  const { colors } = useTheme();
  const hasBudget = budgetTotal > 0;
  const scale = Math.max(hasBudget ? budgetTotal : total, total, 1);
  const over = hasBudget && total > budgetTotal;
  const usedPct = hasBudget ? (total / budgetTotal) * 100 : 100;

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.ink }}>{title}</Text>
        <Text style={{ fontSize: 12, color: colors.inkMuted }}>
          <Money amount={total} currency={currency} style={{ fontSize: 13, fontWeight: "800", color: colors.ink }} />
          {hasBudget ? " of " : ""}
          {hasBudget && <Money amount={budgetTotal} currency={currency} style={{ fontSize: 12, color: colors.inkMuted }} />}
          {hasBudget ? " budget" : ""}
        </Text>
      </View>
      <View style={{ flexDirection: "row", height: 16, borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceSunken }}>
        {slices.map((s) => (
          <View key={s.key} style={{ width: `${(s.amount / scale) * 100}%`, backgroundColor: s.color, borderRightWidth: 1, borderRightColor: colors.surface }} />
        ))}
      </View>
      {hasBudget ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 12, color: over ? colors.expense : colors.inkSubtle, fontWeight: "600" }}>{usedPct.toFixed(0)}% of budget used</Text>
          <Text style={{ fontSize: 12, fontWeight: "700", color: over ? colors.expense : colors.income }}>
            {over ? "Over by " : "Left "}
            <Money amount={Math.abs(budgetTotal - total)} currency={currency} tone={over ? "expense" : "income"} style={{ fontSize: 12, fontWeight: "700" }} />
          </Text>
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: colors.inkSubtle }}>{hint}</Text>
      )}
    </Card>
  );
}
