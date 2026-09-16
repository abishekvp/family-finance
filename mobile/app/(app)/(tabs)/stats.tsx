import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../../../src/api/client";
import type { Transaction } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { getErrorMessage } from "../../../src/api/errors";
import { Card, ErrorText, Segmented, colors } from "../../../src/components/ui";
import { formatCurrency, safePercent } from "../../../src/lib/format";
import { monthRange, yearRange } from "../../../src/lib/dateUtils";
import { CategoryBadge } from "../../../src/components/transactions/TransactionRow";

type TypeFilter = "EXPENSE" | "INCOME";
type PeriodMode = "monthly" | "yearly";

const SWATCH_COLORS = [colors.brand600, "#0EA5E9", "#F59E0B", "#EC4899", "#10B981", "#8B5CF6", "#F97316", "#14B8A6"];

interface CategorySlice {
  key: string;
  name: string;
  color: string;
  amount: number;
}

export default function Stats() {
  const { user } = useAuth();
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
        map.set(key, {
          key,
          name: t.category?.name ?? "Uncategorized",
          color: t.category?.color ?? colors.slate400,
          amount: t.amount,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [transactions]);

  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  const periodLabel =
    periodMode === "monthly"
      ? anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : String(anchor.getFullYear());

  function shift(delta: number) {
    setAnchor((d) =>
      periodMode === "monthly" ? new Date(d.getFullYear(), d.getMonth() + delta, 1) : new Date(d.getFullYear() + delta, 0, 1)
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.slate50 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
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

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 }}>
        <Pressable hitSlop={10} onPress={() => shift(-1)}>
          <Text style={{ fontSize: 18, color: colors.slate500 }}>‹</Text>
        </Pressable>
        <Text style={{ fontWeight: "700", fontSize: 15 }}>{periodLabel}</Text>
        <Pressable hitSlop={10} onPress={() => shift(1)}>
          <Text style={{ fontSize: 18, color: colors.slate500 }}>›</Text>
        </Pressable>
      </View>

      <ErrorText>{error}</ErrorText>

      {isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.brand600} size="large" />
        </View>
      ) : slices.length === 0 ? (
        <Card>
          <Text style={{ color: colors.slate400, fontSize: 13, textAlign: "center" }}>
            No {typeFilter === "EXPENSE" ? "expenses" : "income"} for this {periodMode === "monthly" ? "month" : "year"} yet.
          </Text>
        </Card>
      ) : (
        <>
          <Card style={{ gap: 12 }}>
            <Text style={{ color: colors.slate500, fontSize: 13 }}>Total {typeFilter === "EXPENSE" ? "spent" : "earned"}</Text>
            <Text style={{ fontSize: 24, fontWeight: "700" }}>{formatCurrency(total, family.currency)}</Text>
            <View style={{ flexDirection: "row", height: 16, borderRadius: 8, overflow: "hidden", backgroundColor: colors.slate200 }}>
              {slices.map((s, i) => (
                <View
                  key={s.key}
                  style={{
                    flex: Math.max(safePercent(s.amount, total), 0.5),
                    backgroundColor: s.color === "#6366F1" || !s.color ? SWATCH_COLORS[i % SWATCH_COLORS.length] : s.color,
                  }}
                />
              ))}
            </View>
          </Card>

          <Card style={{ gap: 12 }}>
            {slices.map((s, i) => {
              const pct = safePercent(s.amount, total);
              const color = s.color === "#6366F1" || !s.color ? SWATCH_COLORS[i % SWATCH_COLORS.length] : s.color;
              return (
                <View key={s.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <CategoryBadge color={color} label={s.name[0]?.toUpperCase() ?? "?"} size={28} />
                  <Text style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.slate500, width: 44, textAlign: "right" }}>
                    {pct.toFixed(0)}%
                  </Text>
                  <Text style={{ fontSize: 13, fontWeight: "700", width: 90, textAlign: "right" }}>
                    {formatCurrency(s.amount, family.currency)}
                  </Text>
                </View>
              );
            })}
          </Card>
        </>
      )}
    </ScrollView>
  );
}
