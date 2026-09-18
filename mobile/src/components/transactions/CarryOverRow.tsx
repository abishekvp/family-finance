import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ArrowLeftRight } from "lucide-react-native";
import { api } from "../../api/client";
import type { Account, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { Money } from "../ui";
import { computeCumulativeBalance } from "../../lib/balance";

/**
 * Shown instead of a bare empty state when Settings' carry-over pref is ON and the viewed
 * period has zero transactions: fetches every transaction dated before `periodStart` and
 * folds it (plus opening balances) into the accounts' cumulative balance as of that instant.
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
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(false);
    api
      .get<Transaction[]>(`/families/${familyId}/transactions`, {
        params: { to: periodStart.toISOString(), limit: 1000 },
      })
      .then((res) => {
        if (cancelled) return;
        setBalance(computeCumulativeBalance(accounts, res.data, accountIds));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, periodStart.getTime(), accounts, accountIds]);

  if (error) return null;

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
