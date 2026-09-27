import { useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ArrowLeftRight } from "lucide-react-native";
import type { Account } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { Money } from "../ui";
import { computeCumulativeBalance } from "../../lib/balance";
import { useTransactions } from "../../lib/transactionStore";

/**
 * Shown instead of a bare empty state when Settings' carry-over pref is ON and the viewed
 * period has zero transactions: takes every transaction dated before `periodStart` (from the copy
 * kept on the device) and folds it (plus opening balances) into the accounts' cumulative balance
 * as of that instant.
 */
export function CarryOverRow({
  familyId,
  periodStart,
  accounts,
  accountIds,
  currency,
}: {
  familyId: string;
  periodStart: Date;
  accounts: Account[];
  accountIds: Set<string>;
  currency: string;
}) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const periodMs = periodStart.getTime();
  const filter = useMemo(() => ({ to: new Date(periodMs), sealed: true }), [periodMs]);
  const { transactions: prior, ready: isReady, error } = useTransactions(user!.id, familyId, filter);
  const isLoading = !isReady;
  const balance = useMemo(() => computeCumulativeBalance(accounts, prior, accountIds), [accounts, prior, accountIds]);

  if (error && !isReady) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 16,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: colors.lineStrong,
        padding: 14,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: colors.surfaceSunken,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ArrowLeftRight size={15} color={colors.inkSubtle} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "700", color: colors.ink, fontSize: 13 }}>Carried over</Text>
        <Text style={{ color: colors.inkSubtle, fontSize: 11, marginTop: 1 }}>Balance brought into this period</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.brand600} />
      ) : (
        <Money amount={balance} currency={currency} tone="auto" style={{ fontWeight: "800", fontSize: 14 }} />
      )}
    </View>
  );
}
