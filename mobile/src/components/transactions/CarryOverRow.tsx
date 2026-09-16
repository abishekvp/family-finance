import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { api } from "../../api/client";
import type { Account, Transaction } from "../../api/types";
import { colors } from "../../components/ui";
import { computeCumulativeBalance } from "../../lib/balance";
import { formatCurrency } from "../../lib/format";

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
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 4,
        borderTopWidth: 1,
        borderTopColor: colors.slate200,
      }}
    >
      <View>
        <Text style={{ fontWeight: "600" }}>Carry-over</Text>
        <Text style={{ color: colors.slate500, fontSize: 12, marginTop: 2 }}>Balance brought into this period</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.brand600} />
      ) : (
        <Text style={{ fontWeight: "700", color: balance < 0 ? colors.red600 : colors.slate900 }}>
          {formatCurrency(balance, currency)}
        </Text>
      )}
    </View>
  );
}
