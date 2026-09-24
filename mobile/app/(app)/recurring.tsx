import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Plus, Repeat } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { RecurringFrequency, RecurringTransaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Badge, Button, Card, EmptyState, ErrorText, Money, SkeletonRows, StatTile } from "../../src/components/ui";
import { CategoryBadge } from "../../src/components/transactions/TransactionRow";
import { initials } from "../../src/lib/format";
import { href } from "../../src/lib/nav";
import { describeSchedule, formatDayShort, perMonth } from "../../src/lib/recurring";

const SECTIONS: { frequency: RecurringFrequency; title: string }[] = [
  { frequency: "MONTHLY", title: "Monthly" },
  { frequency: "YEARLY", title: "Yearly" },
  { frequency: "WEEKLY", title: "Weekly" },
];

export default function Recurring() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canRecord = family.role !== "VIEWER";
  const router = useRouter();
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<RecurringTransaction[]>(`/families/${family.id}/recurring`);
      setRules(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load repeating payments"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const active = rules.filter((r) => r.isActive);
  const stopped = rules.filter((r) => !r.isActive);
  const expenses = active.filter((r) => r.type === "EXPENSE");
  const monthlyOut = expenses.filter((r) => r.frequency !== "YEARLY").reduce((sum, r) => sum + perMonth(r), 0);
  const yearlyOut = expenses.filter((r) => r.frequency === "YEARLY").reduce((sum, r) => sum + r.amount, 0);

  function open(rule?: RecurringTransaction) {
    router.push(href("/recurring-form", rule ? { rule: JSON.stringify(rule) } : undefined));
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <StatTile label="Every month" value={monthlyOut} currency={family.currency} tone="expense" loading={isLoading} />
        <StatTile label="Every year" value={yearlyOut} currency={family.currency} tone="expense" loading={isLoading} />
      </View>

      {canRecord && <Button title="Add repeating payment" icon={<Plus size={16} color={colors.white} />} onPress={() => open()} />}

      <Text style={{ color: colors.inkSubtle, fontSize: 12, lineHeight: 17 }}>
        Each payment is recorded automatically on its day. Monthly and weekly ones count in your monthly budget, yearly ones in your
        yearly budget.
      </Text>

      <ErrorText>{error}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Repeat size={20} color={colors.brand600} />}
          title="No repeating payments"
          description="Add a salary, rent, a home maker's pay or a subscription once, and it's recorded every time it's due."
        />
      ) : (
        <>
          {SECTIONS.map((section) => {
            const list = active.filter((r) => r.frequency === section.frequency);
            if (list.length === 0) return null;
            return <RuleList key={section.frequency} title={section.title} rules={list} onPress={open} />;
          })}
          {stopped.length > 0 && <RuleList title="Paused or ended" rules={stopped} onPress={open} />}
        </>
      )}
    </ScrollView>
  );
}

function RuleList({ title, rules, onPress }: { title: string; rules: RecurringTransaction[]; onPress: (r: RecurringTransaction) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.inkSubtle, textTransform: "uppercase", paddingHorizontal: 2 }}>{title}</Text>
      <Card style={{ padding: 0 }}>
        {rules.map((rule, i) => {
          const name = rule.payee || rule.category?.name || "Repeating payment";
          const detail = [rule.isActive ? `Next ${formatDayShort(rule.nextDate)}` : describeSchedule(rule), rule.account.name, rule.category?.name]
            .filter(Boolean)
            .join(" · ");
          return (
            <Pressable
              key={rule.id}
              onPress={() => onPress(rule)}
              style={({ pressed }) => [
                { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line },
                pressed && { backgroundColor: colors.surfaceSunken },
              ]}
            >
              <CategoryBadge color={rule.category?.color ?? colors.inkSubtle} label={initials(name)} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }} numberOfLines={1}>
                  {detail}
                </Text>
                {rule.isActive && (
                  <Text style={{ fontSize: 11.5, color: colors.inkMuted, marginTop: 2 }} numberOfLines={1}>
                    {describeSchedule(rule)}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Money
                  amount={rule.type === "EXPENSE" ? -rule.amount : rule.amount}
                  currency={rule.account.currency}
                  tone={rule.type === "EXPENSE" ? "expense" : "income"}
                  signed
                  style={{ fontWeight: "800" }}
                />
                {!rule.isActive && <Badge>{rule.endDate && rule.nextDate > rule.endDate ? "Ended" : "Paused"}</Badge>}
              </View>
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}
