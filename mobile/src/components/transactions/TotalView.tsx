import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, Landmark, PiggyBank } from "lucide-react-native";
import { api } from "../../api/client";
import type { Account, Budget, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { Button, Card, CardHeader, Dot, ErrorText, Money, ProgressBar } from "../ui";
import { safePercent } from "../../lib/format";
import { localDateInput } from "../../lib/dateUtils";
import { getErrorMessage } from "../../api/errors";
import { CarryOverRow } from "./CarryOverRow";
import { budgetName } from "../../lib/budgets";
import { totalsContribution } from "../../lib/transactionTotals";

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
  const { colors } = useTheme();
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
      [localDateInput(new Date(t.date)), t.type, t.account.name, t.category?.name ?? "", t.payee ?? "", t.amount.toFixed(2), (t.notes ?? "").replace(/[\r\n,]/g, " ")]
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
      <Card style={{ alignItems: "center", paddingVertical: 22 }}>
        <Text style={{ color: colors.inkMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 }}>
          This period
        </Text>
        <Money amount={totals.net} currency={currency} signed style={{ fontSize: 28, fontWeight: "900", marginTop: 6 }} />
        <View style={{ flexDirection: "row", gap: 20, marginTop: 12 }}>
          <Money amount={totals.income} currency={currency} tone="income" signed style={{ fontWeight: "700" }} />
          <Money amount={-totals.expense} currency={currency} tone="expense" signed style={{ fontWeight: "700" }} />
        </View>

        {transactions.length === 0 && carryOver && (
          <View style={{ marginTop: 16, width: "100%" }}>
            <CarryOverRow familyId={familyId} periodStart={new Date(year, month - 1, 1)} accounts={accounts} accountIds={accountIds} currency={currency} />
          </View>
        )}
      </Card>

      <Card>
        <CardHeader title="Budgets" icon={<PiggyBank size={16} color={colors.brand600} />} />
        {isLoadingBudgets ? (
          <ActivityIndicator color={colors.brand600} />
        ) : budgetsError ? (
          <ErrorText>{budgetsError}</ErrorText>
        ) : budgets.length === 0 ? (
          <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No budgets set for this month.</Text>
        ) : (
          <View style={{ gap: 14 }}>
            {budgets.map((b) => {
              const pct = safePercent(b.spent, b.amount);
              const over = b.spent > b.amount;
              return (
                <View key={b.id}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <Dot color={b.category.color} />
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: "700", color: colors.ink }}>{budgetName(b)}</Text>
                    <Text style={{ fontSize: 11.5, color: over ? colors.expense : colors.inkSubtle, fontWeight: "600" }}>
                      {safePercent(b.spent, b.amount).toFixed(0)}%
                    </Text>
                  </View>
                  <ProgressBar value={pct / 100} tone={over ? "expense" : "brand"} />
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <Card>
        <CardHeader title="Accounts" icon={<Landmark size={16} color={colors.brand600} />} />
        {visibleAccounts.length === 0 ? (
          <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No accounts to show.</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {visibleAccounts.map((a) => (
              <View key={a.id} style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 13, color: colors.ink, fontWeight: "600" }}>{a.name}</Text>
                <Money amount={a.balance} currency={a.currency || currency} tone={a.balance < 0 ? "expense" : undefined} style={{ fontSize: 13, fontWeight: "700" }} />
              </View>
            ))}
          </View>
        )}
      </Card>

      <Button
        title={copied ? "Copied CSV to clipboard" : "Export period as CSV"}
        variant="secondary"
        icon={copied ? <Check size={15} color={colors.ink} /> : <Copy size={15} color={colors.ink} />}
        onPress={handleExport}
      />
    </View>
  );
}
