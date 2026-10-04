import { useEffect, useState } from "react";
import { Alert, FlatList, Text, View } from "react-native";
import { ArchiveRestore, RefreshCcw, Trash } from "lucide-react-native";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { api } from "../../src/api/client";
import { fetchWithCache } from "../../src/lib/cache";
import { getErrorMessage } from "../../src/api/errors";
import { syncTransactions } from "../../src/lib/transactionStore";
import type { Transaction } from "../../src/api/types";
import { Button, Card, CardHeader, ErrorText, SuccessText } from "../../src/components/ui";

export default function BinScreen() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];

  const [binned, setBinned] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithCache<Transaction[]>(
        `/families/${family.id}/transactions?bin=true&limit=100`,
        undefined,
        (cached) => setBinned(cached.data)
      );
      setBinned(res.data);
    } catch (err) {
      if (binned.length === 0) setError(getErrorMessage(err, "Failed to load bin"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBin();
  }, []);

  async function handleRestore(t: Transaction) {
    try {
      await api.post(`/families/${family.id}/transactions/${t.id}/restore`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
      await syncTransactions(user!.id, family.id, { force: true });
    } catch (err) {
      Alert.alert("Error", getErrorMessage(err, "Failed to restore"));
    }
  }

  async function handlePurge(t: Transaction) {
    try {
      await api.delete(`/families/${family.id}/transactions/${t.id}/purge`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
    } catch (err) {
      Alert.alert("Error", getErrorMessage(err, "Failed to delete"));
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={binned}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        ListEmptyComponent={
          loading ? (
            <Text style={{ color: colors.inkSubtle, textAlign: "center", marginTop: 20 }}>Loading...</Text>
          ) : (
            <Text style={{ color: colors.inkSubtle, textAlign: "center", marginTop: 20 }}>The bin is empty.</Text>
          )
        }
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 16 }}>
                  {item.payee || item.category?.name || "Transfer"}
                </Text>
                <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
                  {new Date(item.date).toLocaleDateString()}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button variant="secondary" icon={<RefreshCcw size={16} color={colors.ink} />} onPress={() => handleRestore(item)} />
                <Button variant="danger" icon={<Trash size={16} color={colors.expense} />} onPress={() => handlePurge(item)} />
              </View>
            </View>
          </Card>
        )}
      />
    </View>
  );
}
