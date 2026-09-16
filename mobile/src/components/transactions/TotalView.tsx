import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { api } from "../../api/client";
import type { Account, Budget, Transaction } from "../../api/types";
import { Button, Card, colors } from "../../components/ui";
import { formatCurrency, safePercent } from "../../lib/format";
import { getErrorMessage } from "../../api/errors";
import { CarryOverRow } from "./CarryOverRow";

export function TotalView({
  transactions,
  accounts,
  familyId,
  currency,
  anchorMonth,
  selectedAccountIds,
  carryOver,
  accountIds,
}: {
  transactions: Transaction[];
  accounts: Account[];
  familyId: string;
  currency: string;
  anchorMonth: Date;
  selectedAccountIds: Set<string> | null;
  carryOver: boolean;
  accountIds: Set<string>;
}) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetsError, setBudgetsError] = useState<string | null>(null);
  const [isLoadingBudgets, setIsLoadingBudgets] = useState(true);
  const [copied, setCopied] = useState(false);

  const year = anchorMonth.getFullYear();
  const month = anchorMonth.getMonth() + 1;

  useEffect(() => {
    let cancelled = false;
    setIsLoadingBudgets(true);
    setBudgetsError(null);
    api
      .get<Budget[]>(`/families/${familyId}/budgets`, { params: { year, month } })
      .then((res) => {
        if (!cancelled) setBudgets(res.data);
      })
      .catch((err) => {
        if (!cancelled) setBudgetsError(getErrorMessage(err, "Unable to load budgets"));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBudgets(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, year, month, transactions]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      if (t.type === "INCOME") income += t.amount;
      else if (t.type === "EXPENSE") expense += t.amount;
    }
    return { income, expense, net: income - expense };
  }, [transactions]);

  const visibleAccounts = useMemo(
    () => (selectedAccountIds === null ? accounts : accounts.filter((a) => selectedAccountIds.has(a.id))),
    [accounts, selectedAccountIds]
  );

  async function handleExport() {
    const header = "date,type,account,category,payee,amount,notes";
    const rows = transactions.map((t) =>
      [
        t.date.slice(0, 10),
        t.type,
        t.account.name,
        t.category?.name ?? "",
        t.payee ?? "",
        t.amount.toFixed(2),
        (t.notes ?? "").replace(/[\r\n,]/g, " "),
      ]
        .map((field) => `"${String(field).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...rows].join("\n");
    await Clipboard.setStringAsync(csv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: colors.slate500, fontSize: 13 }}>This period</Text>
        <Text style={{ fontSize: 26, fontWeight: "700", color: totals.net < 0 ? colors.red600 : colors.slate900 }}>
          {formatCurrency(totals.net, currency)}
        </Text>
        <View style={{ flexDirection: "row", gap: 24 }}>
          <View>
            <Text style={{ color: colors.slate500, fontSize: 12 }}>Income</Text>
            <Text style={{ fontWeight: "700", color: colors.green600 }}>{formatCurrency(totals.income, currency)}</Text>
          </View>
          <View>
            <Text style={{ color: colors.slate500, fontSize: 12 }}>Expense</Text>
            <Text style={{ fontWeight: "700", color: colors.red600 }}>{formatCurrency(totals.expense, currency)}</Text>
          </View>
        </View>

        {transactions.length === 0 && carryOver && (
          <CarryOverRow
            familyId={familyId}
            periodStart={new Date(year, month - 1, 1)}
            accounts={accounts}
            accountIds={accountIds}
            currency={currency}
          />
        )}
      </Card>

      <View>
        <Text style={{ fontSize: 15, fontWeight: "700", marginBottom: 8 }}>Budgets</Text>
        <Card style={{ gap: 10 }}>
          {isLoadingBudgets ? (
            <ActivityIndicator color={colors.brand600} />
          ) : budgetsError ? (
            <Text style={{ color: colors.red600, fontSize: 13 }}>{budgetsError}</Text>
          ) : budgets.length === 0 ? (
            <Text style={{ color: colors.slate400, fontSize: 13 }}>No budgets set for this month.</Text>
          ) : (
            budgets.map((b) => {
              const pct = safePercent(b.spent, b.amount);
              const over = b.spent > b.amount;
              return (
                <View key={b.id}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600" }}>{b.category.name}</Text>
                    <Text style={{ fontSize: 12, color: over ? colors.red600 : colors.slate500 }}>
                      {formatCurrency(b.spent, currency)} / {formatCurrency(b.amount, currency)}
                    </Text>
                  </View>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.slate200, overflow: "hidden" }}>
                    <View
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        backgroundColor: over ? colors.red600 : colors.brand600,
                      }}
                    />
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </View>

      <View>
        <Text style={{ fontSize: 15, fontWeight: "700", marginBottom: 8 }}>Accounts</Text>
        <Card style={{ gap: 10 }}>
          {visibleAccounts.length === 0 ? (
            <Text style={{ color: colors.slate400, fontSize: 13 }}>No accounts to show.</Text>
          ) : (
            visibleAccounts.map((a) => (
              <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13 }}>{a.name}</Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: a.balance < 0 ? colors.red600 : colors.slate900 }}>
                  {formatCurrency(a.balance, a.currency || currency)}
                </Text>
              </View>
            ))
          )}
        </Card>
      </View>

      <Button title={copied ? "Copied CSV to clipboard" : "Export period as CSV"} variant="secondary" onPress={handleExport} />
    </View>
  );
}
