import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ChevronLeft, ChevronRight, PieChart as PieChartIcon } from "lucide-react-native";
import { api } from "../../../src/api/client";
import type { Transaction } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { useTheme } from "../../../src/context/ThemeContext";
import { getErrorMessage } from "../../../src/api/errors";
import { Card, Dot, EmptyState, ErrorText, IconButton, Money, ProgressBar, Segmented, SkeletonRows } from "../../../src/components/ui";
import { safePercent } from "../../../src/lib/format";
import { monthRange, yearRange } from "../../../src/lib/dateUtils";
import { CHART_SWATCHES } from "../../../src/theme";

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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { from, to } = periodMode === "monthly" ? monthRange(anchor) : yearRange(anchor.getFullYear());
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { type: typeFilter, from: from.toISOString(), to: to.toISOString(), limit: 1000 },
      });
      setTransactions(res.data);
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
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
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
          <Card style={{ alignItems: "center", gap: 12, paddingVertical: 22 }}>
            <Text style={{ color: colors.inkMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>
              Total {typeFilter === "EXPENSE" ? "spent" : "earned"}
            </Text>
            <Money amount={total} currency={family.currency} style={{ fontSize: 26, fontWeight: "900" }} />
            <View style={{ flexDirection: "row", height: 14, width: "100%", borderRadius: 8, overflow: "hidden", backgroundColor: colors.surfaceSunken }}>
              {slices.map((s, i) => (
                <View
                  key={s.key}
                  style={{
                    flex: Math.max(safePercent(s.amount, total), 1.2),
                    backgroundColor: s.color === "#6366F1" || !s.color ? CHART_SWATCHES[i % CHART_SWATCHES.length] : s.color,
                  }}
                />
              ))}
            </View>
          </Card>

          <Card style={{ gap: 14 }}>
            {slices.map((s, i) => {
              const pct = safePercent(s.amount, total);
              const color = s.color === "#6366F1" || !s.color ? CHART_SWATCHES[i % CHART_SWATCHES.length] : s.color;
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
                  <ProgressBar value={pct / 100} />
                </View>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
