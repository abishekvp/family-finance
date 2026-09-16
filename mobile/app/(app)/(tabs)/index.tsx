import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { api } from "../../../src/api/client";
import type { Account, Transaction } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { usePrefs } from "../../../src/context/PrefsContext";
import { getErrorMessage } from "../../../src/api/errors";
import { ErrorText, Segmented, colors } from "../../../src/components/ui";
import { monthRange, yearRange } from "../../../src/lib/dateUtils";
import { href } from "../../../src/lib/nav";
import { DailyView } from "../../../src/components/transactions/DailyView";
import { CalendarView } from "../../../src/components/transactions/CalendarView";
import { MonthlyView } from "../../../src/components/transactions/MonthlyView";
import { TotalView } from "../../../src/components/transactions/TotalView";
import { FilterModal } from "../../../src/components/transactions/FilterModal";

type SubView = "daily" | "calendar" | "monthly" | "total";

const SUB_VIEW_OPTIONS: { value: SubView; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "calendar", label: "Calendar" },
  { value: "monthly", label: "Monthly" },
  { value: "total", label: "Total" },
];

export default function TransactionsHub() {
  const { user } = useAuth();
  const family = user!.families[0];
  const router = useRouter();
  const navigation = useNavigation();
  const { prefs, isLoading: prefsLoading } = usePrefs();

  const [subView, setSubView] = useState<SubView>("daily");
  const didInitFromPrefs = useRef(false);
  useEffect(() => {
    // One-time sync from the persisted default landing view, before the user touches the toggle.
    if (!prefsLoading && !didInitFromPrefs.current) {
      didInitFromPrefs.current = true;
      setSubView(prefs.landingView);
    }
  }, [prefsLoading, prefs.landingView]);

  const [anchorMonth, setAnchorMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [periodTransactions, setPeriodTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string> | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);

  const loadAccounts = useCallback(async () => {
    const res = await api.get<Account[]>(`/families/${family.id}/accounts`);
    setAccounts(res.data);
  }, [family.id]);

  const loadPeriod = useCallback(async () => {
    const { from, to } = subView === "monthly" ? yearRange(selectedYear) : monthRange(anchorMonth);
    const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, {
      params: { from: from.toISOString(), to: to.toISOString(), limit: 1000 },
    });
    setPeriodTransactions(res.data);
  }, [family.id, subView, anchorMonth, selectedYear]);

  const loadAll = useCallback(async () => {
    try {
      await Promise.all([loadAccounts(), loadPeriod()]);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load transactions"));
    } finally {
      setIsLoading(false);
    }
  }, [loadAccounts, loadPeriod]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      loadAll();
    }, [loadAll])
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setFilterVisible(true)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: selectedAccountIds ? colors.brand600 : colors.slate700 }}>
            Filter{selectedAccountIds ? ` (${selectedAccountIds.size})` : ""}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, selectedAccountIds]);

  const filteredTransactions = useMemo(() => {
    if (selectedAccountIds === null) return periodTransactions;
    return periodTransactions.filter((t) => selectedAccountIds.has(t.accountId));
  }, [periodTransactions, selectedAccountIds]);

  const scopedAccountIds = useMemo(
    () => selectedAccountIds ?? new Set(accounts.map((a) => a.id)),
    [selectedAccountIds, accounts]
  );

  function openTransaction(t: Transaction) {
    router.push(href("/transaction-form", { id: t.id, transaction: JSON.stringify(t) }));
  }

  function openNewTransaction() {
    router.push(href("/transaction-form"));
  }

  const monthLabel = anchorMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <View style={{ flex: 1, backgroundColor: colors.slate50 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 12 }}>
        <Segmented options={SUB_VIEW_OPTIONS} value={subView} onChange={setSubView} />

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 }}>
          <Pressable
            hitSlop={10}
            onPress={() =>
              subView === "monthly"
                ? setSelectedYear((y) => y - 1)
                : setAnchorMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
            }
          >
            <Text style={{ fontSize: 18, color: colors.slate500 }}>‹</Text>
          </Pressable>
          <Text style={{ fontWeight: "700", fontSize: 15 }}>{subView === "monthly" ? selectedYear : monthLabel}</Text>
          <Pressable
            hitSlop={10}
            onPress={() =>
              subView === "monthly"
                ? setSelectedYear((y) => y + 1)
                : setAnchorMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
            }
          >
            <Text style={{ fontSize: 18, color: colors.slate500 }}>›</Text>
          </Pressable>
        </View>

        <ErrorText>{error}</ErrorText>

        {isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}>
            <ActivityIndicator color={colors.brand600} size="large" />
          </View>
        ) : subView === "daily" ? (
          <DailyView
            transactions={filteredTransactions}
            accounts={accounts}
            familyId={family.id}
            currency={family.currency}
            periodStart={anchorMonth}
            carryOver={prefs.carryOver}
            accountIds={scopedAccountIds}
            onPressTransaction={openTransaction}
          />
        ) : subView === "calendar" ? (
          <CalendarView
            transactions={filteredTransactions}
            accounts={accounts}
            familyId={family.id}
            currency={family.currency}
            anchorMonth={anchorMonth}
            weekStart={prefs.weekStart}
            carryOver={prefs.carryOver}
            accountIds={scopedAccountIds}
            onPressTransaction={openTransaction}
          />
        ) : subView === "monthly" ? (
          <MonthlyView
            transactions={filteredTransactions}
            accounts={accounts}
            familyId={family.id}
            currency={family.currency}
            year={selectedYear}
            weekStart={prefs.weekStart}
            carryOver={prefs.carryOver}
            accountIds={scopedAccountIds}
          />
        ) : (
          <TotalView
            transactions={filteredTransactions}
            accounts={accounts}
            familyId={family.id}
            currency={family.currency}
            anchorMonth={anchorMonth}
            selectedAccountIds={selectedAccountIds}
            carryOver={prefs.carryOver}
            accountIds={scopedAccountIds}
          />
        )}
      </ScrollView>

      <Pressable
        onPress={openNewTransaction}
        style={({ pressed }) => ({
          position: "absolute",
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: colors.brand600,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.85 : 1,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 6,
          elevation: 4,
        })}
      >
        <Text style={{ color: colors.white, fontSize: 28, fontWeight: "300", marginTop: -2 }}>+</Text>
      </Pressable>

      <FilterModal
        visible={filterVisible}
        accounts={accounts}
        periodTransactions={periodTransactions}
        selectedAccountIds={selectedAccountIds}
        onChange={setSelectedAccountIds}
        currency={family.currency}
        onClose={() => setFilterVisible(false)}
      />
    </View>
  );
}
