import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";
import { ArchiveRestore, Trash2 } from "lucide-react-native";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { api } from "../../src/api/client";
import { getErrorMessage } from "../../src/api/errors";
import { syncTransactions } from "../../src/lib/transactionStore";
import { refreshTodayWidget } from "../../src/lib/todayWidget";
import { formatTime } from "../../src/lib/dateUtils";
import type { Transaction } from "../../src/api/types";
import { Card, EmptyState, ErrorText, IconButton, Money, SkeletonRows } from "../../src/components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

function describe(t: Transaction) {
  return t.payee || t.category?.name || (t.type === "TRANSFER" ? "Transfer" : t.type === "INCOME" ? "Income" : "Expense");
}

/** Deleted transactions: restored with one tap, or deleted for good after a confirmation. */
export default function BinScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canEdit = family.role !== "VIEWER";

  const [binned, setBinned] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBin = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { bin: "true", limit: 200 } });
      setBinned(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't load the bin"));
    } finally {
      setLoading(false);
    }
  }, [family.id]);

  useEffect(() => {
    loadBin();
  }, [loadBin]);

  async function handleRestore(t: Transaction) {
    try {
      await api.post(`/families/${family.id}/transactions/${t.id}/restore`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
      await syncTransactions(user!.id, family.id, { force: true });
      refreshTodayWidget(family.id, family.currency);
    } catch (err) {
      Alert.alert("Couldn't restore it", getErrorMessage(err, "Please try again."));
    }
  }

  function confirmPurge(t: Transaction) {
    Alert.alert("Delete for good?", `“${describe(t)}” will be deleted permanently. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api.delete(`/families/${family.id}/transactions/${t.id}/purge`);
            setBinned((prev) => prev.filter((x) => x.id !== t.id));
          } catch (err) {
            Alert.alert("Couldn't delete it", getErrorMessage(err, "Please try again."));
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={4} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FlatList
        data={binned}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.inkSubtle, fontSize: 12.5, lineHeight: 18 }}>
              {`Deleted transactions stay here for ${RETENTION_DAYS} days, then they're removed for good. Restoring one puts it back in your balances.`}
            </Text>
            <ErrorText>{error}</ErrorText>
          </View>
        }
        ListEmptyComponent={!error ? <EmptyState icon={<Trash2 size={20} color={colors.brand600} />} title="The bin is empty" /> : null}
        renderItem={({ item }) => {
          const deletedAt = item.deletedAt ? new Date(item.deletedAt) : null;
          const daysLeft = deletedAt ? Math.max(0, RETENTION_DAYS - Math.floor((Date.now() - deletedAt.getTime()) / DAY_MS)) : null;
          return (
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                  {describe(item)}
                </Text>
                <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {`${new Date(item.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${formatTime(item.date)} · ${item.account.name}`}
                </Text>
                {daysLeft !== null && (
                  <Text style={{ color: colors.inkSubtle, fontSize: 11.5, marginTop: 2 }}>
                    {daysLeft === 0 ? "Deleted for good today" : `Deleted for good in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                  </Text>
                )}
              </View>
              <Money
                amount={item.type === "EXPENSE" ? -item.amount : item.amount}
                currency={item.account.currency}
                signed={item.type !== "TRANSFER"}
                style={{ fontWeight: "800", fontSize: 13.5 }}
              />
              {canEdit && (
                <View style={{ flexDirection: "row", gap: 2 }}>
                  <IconButton tone="brand" onPress={() => handleRestore(item)} accessibilityLabel={`Restore ${describe(item)}`}>
                    <ArchiveRestore size={17} color={colors.brand600} />
                  </IconButton>
                  <IconButton tone="danger" onPress={() => confirmPurge(item)} accessibilityLabel={`Delete ${describe(item)} for good`}>
                    <Trash2 size={17} color={colors.expense} />
                  </IconButton>
                </View>
              )}
            </Card>
          );
        }}
      />
    </View>
  );
}
