import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, HandCoins } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account, Transaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, Money, SkeletonRows, StatTile } from "../../src/components/ui";
import { href } from "../../src/lib/nav";
import { balanceStatus, isPerson, isSettled, lendingTotals, nextDue, trackLoans } from "../../src/lib/lending";

type Due = { dueDate: Date | null; overdue: boolean };

export default function Lending() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canRecord = family.role !== "VIEWER";
  const router = useRouter();
  const [people, setPeople] = useState<Account[]>([]);
  // Per person with money outstanding: the earliest return-by date, and whether any is overdue.
  const [dues, setDues] = useState<Record<string, Due>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Account[]>(`/families/${family.id}/accounts`);
      const found = res.data.filter(isPerson);
      setPeople(found);
      setError(null);
      const open = found.filter((p) => !isSettled(p.balance));
      const histories = await Promise.all(
        open.map((p) => api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { accountId: p.id, limit: 1000 } }))
      );
      setDues(Object.fromEntries(open.map((p, i) => [p.id, nextDue(trackLoans(histories[i].data, p))])));
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const { owedToYou, youOwe } = lendingTotals(people);
  const open = people.filter((p) => !isSettled(p.balance)).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  const settled = people.filter((p) => isSettled(p.balance));

  function record(kind: "lent" | "borrowed") {
    router.push(href("/transaction-form", { type: "LENDING", kind }));
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <StatTile label="Owed to you" value={owedToYou} currency={family.currency} tone="income" loading={isLoading} />
        <StatTile label="You owe" value={youOwe} currency={family.currency} tone="expense" loading={isLoading} />
      </View>

      {canRecord && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button title="Lend" icon={<ArrowUpRight size={16} color={colors.white} />} onPress={() => record("lent")} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Borrow" variant="secondary" icon={<ArrowDownLeft size={16} color={colors.ink} />} onPress={() => record("borrowed")} />
          </View>
        </View>
      )}

      <Text style={{ color: colors.inkSubtle, fontSize: 12, lineHeight: 17 }}>
        Money you lend or borrow moves between your accounts and the person, so it changes your balances but never counts as
        income or an expense.
      </Text>

      <ErrorText>{error}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : people.length === 0 ? (
        <EmptyState
          icon={<HandCoins size={20} color={colors.brand600} />}
          title="Nothing lent or borrowed"
          description="Track money you lend to friends or borrow from them, and what's been paid back."
        />
      ) : (
        <>
          {open.length > 0 && <PeopleList title="Open" people={open} dues={dues} onPress={(p) => router.push(href("/lending-person", { id: p.id }))} />}
          {settled.length > 0 && <PeopleList title="Settled up" people={settled} dues={dues} onPress={(p) => router.push(href("/lending-person", { id: p.id }))} />}
        </>
      )}
    </ScrollView>
  );
}

function PeopleList({ title, people, dues, onPress }: { title: string; people: Account[]; dues: Record<string, Due>; onPress: (p: Account) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.inkSubtle, textTransform: "uppercase", paddingHorizontal: 2 }}>{title}</Text>
      <Card style={{ padding: 0 }}>
        {people.map((p, i) => {
          const settled = isSettled(p.balance);
          const due = settled ? null : dues[p.id];
          return (
            <Pressable
              key={p.id}
              onPress={() => onPress(p)}
              style={({ pressed }) => [
                { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line },
                pressed && { backgroundColor: colors.surfaceSunken },
              ]}
            >
              <Avatar name={p.name} size={38} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
                  {balanceStatus(p.balance)}
                  {p.owner ? "" : " · Shared"}
                  {due?.dueDate && !due.overdue
                    ? ` · Return by ${due.dueDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                    : ""}
                </Text>
              </View>
              {due?.overdue && <Badge tone="expense">Overdue</Badge>}
              {!settled && (
                <Money amount={Math.abs(p.balance)} currency={p.currency} tone={p.balance > 0 ? "income" : "expense"} style={{ fontWeight: "800" }} />
              )}
              <ChevronRight size={16} color={colors.inkSubtle} />
            </Pressable>
          );
        })}
      </Card>
    </View>
  );
}
