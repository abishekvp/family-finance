import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useFocusEffect, useNavigation, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, Filter as FilterIcon, Plus } from "lucide-react-native";
import { api } from "../../../src/api/client";
import { fetchWithCache } from "../../../src/lib/cache";
import type { Account, Transaction } from "../../../src/api/types";
import { useAuth } from "../../../src/context/AuthContext";
import { usePrefs } from "../../../src/context/PrefsContext";
import { useSmsImport } from "../../../src/context/SmsImportContext";
import { useTheme } from "../../../src/context/ThemeContext";
import { getErrorMessage } from "../../../src/api/errors";
import { ErrorText, IconButton, Money, Segmented, SkeletonRows, tap } from "../../../src/components/ui";
import { monthRange, yearRange } from "../../../src/lib/dateUtils";
import { href } from "../../../src/lib/nav";
import { useRecurringVersion } from "../../../src/lib/recurring";
import { useTransactions } from "../../../src/lib/transactionStore";
import { DailyView } from "../../../src/components/transactions/DailyView";
import { CalendarView } from "../../../src/components/transactions/CalendarView";
import { MonthlyView } from "../../../src/components/transactions/MonthlyView";
import { TotalView } from "../../../src/components/transactions/TotalView";
import { FilterModal } from "../../../src/components/transactions/FilterModal";
import * as Haptics from "expo-haptics";
import { totalsContribution } from "../../../src/lib/transactionTotals";

type SubView = "daily" | "calendar" | "monthly" | "total";

// The daily list draws this many rows at first and this many more each time it nears the bottom.
const DAILY_PAGE = 40;

const SUB_VIEW_OPTIONS: { value: SubView; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "calendar", label: "Calendar" },
  { value: "monthly", label: "Monthly" },
  { value: "total", label: "Total" },
];

export default function TransactionsHub() {
  const { user } = useAuth();
  const family = user!.families[0];
  const { colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { prefs, isLoading: prefsLoading } = usePrefs();

  const [subView, setSubView] = useState<SubView>("daily");
  const didInitFromPrefs = useRef(false);
  useEffect(() => {
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
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string> | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);

  // Read from the copy kept on the device, so switching months or views never waits on the network.
  const period = useMemo(
    () => (subView === "monthly" ? yearRange(selectedYear) : monthRange(anchorMonth)),
    [subView, selectedYear, anchorMonth]
  );
  const { transactions: periodTransactions, ready, error: syncError, sync } = useTransactions(user!.id, family.id, period);
  const isLoading = !ready;
  // A failed sync over a copy already on screen isn't worth an alarm; it's retried on the next visit.
  const error = accountsError ?? (ready ? null : syncError);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetchWithCache<Account[]>(`/families/${family.id}/accounts`, undefined, (cached) => { setAccounts(cached.data); setAccountsError(null); }, 5 * 60 * 1000);
      setAccounts(res.data);
      setAccountsError(null);
    } catch (err) {
      setAccountsError(getErrorMessage(err, "Unable to load accounts"));
    }
  }, [family.id]);

  const loadAll = useCallback(
    (force = true) => {
      loadAccounts();
      sync({ force });
    },
    [loadAccounts, sync]
  );

  useFocusEffect(
    useCallback(() => {
      // Back from adding or editing one: the save is already in the local copy, so this only picks
      // up what others changed.
      loadAll(false);
    }, [loadAll])
  );

  // An SMS scan can record transactions while this screen is already showing.
  const { syncVersion } = useSmsImport();
  const seenSyncVersion = useRef(syncVersion);
  useEffect(() => {
    if (syncVersion === seenSyncVersion.current) return;
    seenSyncVersion.current = syncVersion;
    loadAll();
  }, [syncVersion, loadAll]);

  // Likewise when repeating payments are recorded on launch or return to the app.
  const recurringVersion = useRecurringVersion();
  const seenRecurringVersion = useRef(recurringVersion);
  useEffect(() => {
    if (recurringVersion === seenRecurringVersion.current) return;
    seenRecurringVersion.current = recurringVersion;
    loadAll();
  }, [recurringVersion, loadAll]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => setFilterVisible(true)} hitSlop={10} style={{ paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 4 }}>
          <FilterIcon size={15} color={selectedAccountIds ? colors.brand600 : colors.inkMuted} />
          <Text style={{ fontSize: 13, fontWeight: "700", color: selectedAccountIds ? colors.brand600 : colors.inkMuted }}>
            {selectedAccountIds ? `(${selectedAccountIds.size})` : "Filter"}
          </Text>
        </Pressable>
      ),
    });
  }, [navigation, selectedAccountIds, colors]);

  const filteredTransactions = useMemo(() => {
    if (selectedAccountIds === null) return periodTransactions;
    return periodTransactions.filter((t) => selectedAccountIds.has(t.accountId));
  }, [periodTransactions, selectedAccountIds]);

  // Load on scroll: a busy month draws its first rows at once and the rest as they come into view.
  const [dailyLimit, setDailyLimit] = useState(DAILY_PAGE);
  useEffect(() => {
    setDailyLimit(DAILY_PAGE);
  }, [anchorMonth, selectedAccountIds, subView]);
  const hasMoreDaily = subView === "daily" && filteredTransactions.length > dailyLimit;
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasMoreDaily) return;
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 600) {
        setDailyLimit((n) => n + DAILY_PAGE);
      }
    },
    [hasMoreDaily]
  );

  const scopedAccountIds = useMemo(() => selectedAccountIds ?? new Set(accounts.map((a) => a.id)), [selectedAccountIds, accounts]);

    const periodTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of filteredTransactions) {
      const counted = totalsContribution(t);
      income += counted.income;
      expense += counted.expense;
    }
    return { income, expense, net: income - expense };
  }, [filteredTransactions]);

  function openTransaction(t: Transaction) {
    router.push(href("/transaction-form", { id: t.id, transaction: JSON.stringify(t) }));
  }

  function openNewTransaction() {
    tap(Haptics.ImpactFeedbackStyle.Medium);
    router.push(href("/transaction-form"));
  }

  const monthLabel = anchorMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 14 }} onScroll={handleScroll} scrollEventThrottle={100}>
        <Segmented options={SUB_VIEW_OPTIONS} value={subView} onChange={setSubView} fullWidth />

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <IconButton
            onPress={() =>
              subView === "monthly" ? setSelectedYear((y) => y - 1) : setAnchorMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
            }
          >
            <ChevronLeft size={19} color={colors.inkMuted} />
          </IconButton>
          <Text style={{ fontWeight: "800", fontSize: 15, color: colors.ink, minWidth: 140, textAlign: "center" }}>
            {subView === "monthly" ? selectedYear : monthLabel}
          </Text>
          <IconButton
            onPress={() =>
              subView === "monthly" ? setSelectedYear((y) => y + 1) : setAnchorMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
            }
          >
            <ChevronRight size={19} color={colors.inkMuted} />
          </IconButton>
        </View>

        {subView !== "total" && (
          <View style={{ flexDirection: "row", justifyContent: "space-around", backgroundColor: colors.surfaceSunken, borderRadius: 14, paddingVertical: 12 }}>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase" }}>Income</Text>
              <Money amount={periodTotals.income} currency={family.currency} tone="income" style={{ fontWeight: "800", marginTop: 2 }} />
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase" }}>Expenses</Text>
              <Money amount={periodTotals.expense} currency={family.currency} tone="expense" style={{ fontWeight: "800", marginTop: 2 }} />
            </View>
            <View style={{ alignItems: "center" }}>
              <Text style={{ fontSize: 10, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase" }}>Net</Text>
              <Money amount={periodTotals.net} currency={family.currency} signed style={{ fontWeight: "800", marginTop: 2 }} />
            </View>
          </View>
        )}

        <ErrorText>{error}</ErrorText>

        {isLoading ? (
          <SkeletonRows rows={5} />
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
            limit={dailyLimit}
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
          width: 58,
          height: 58,
          borderRadius: 29,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.brand600,
          shadowColor: colors.brand600,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.4,
          shadowRadius: 12,
          elevation: 6,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        })}
      >
        <Plus size={26} color="#fff" />
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


