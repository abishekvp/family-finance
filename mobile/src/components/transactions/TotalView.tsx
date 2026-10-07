import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, Landmark, PiggyBank } from "lucide-react-native";
import { api } from "../../api/client";
import type { Account, Budget, Transaction } from "../../api/types";
import { useTheme } from "../../context/ThemeContext";
import { Button, Card, CardHeader, Dot, ErrorText, Money, ProgressBar } from "../ui";
import { formatCurrency, safePercent } from "../../lib/format";
import { localDateInput } from "../../lib/dateUtils";
import { getErrorMessage } from "../../api/errors";
import { CarryOverRow } from "./CarryOverRow";
import { budgetName } from "../../lib/budgets";
import { totalsContribution } from "../../lib/transactionTotals";
import { isPerson, lendingTotals } from "../../lib/lending";

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

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of transactions) {
      const counted = totalsContribution(t);
      income += counted.income;
      expense += counted.expense;
    }
    return { income, expense, net: income - expense };
  }, [transactions]);

  // Budgets only move when spending does: refetched when the period's spending changes, not on every
  // sync that hands back a new (but equal) list.
  const spentKey = Math.round(totals.expense * 100);
  useEffect(() => {
    let cancelled = false;
    setIsLoadingBudgets(true);
    setBudgetsError(null);
    api
      .get<Budget[]>(`/families/${familyId}/budgets`, { params: { year, month, tzOffset: new Date().getTimezoneOffset() } })
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
  }, [familyId, year, month, spentKey]);

  // Your own accounts; what's owed between you and people you lend to is summed up separately.
  const visibleAccounts = useMemo(
    () => accounts.filter((a) => !isPerson(a) && (selectedAccountIds === null || selectedAccountIds.has(a.id))),
    [accounts, selectedAccountIds]
  );
  const lending = useMemo(() => lendingTotals(accounts.filter(isPerson)), [accounts]);

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
            {(lending.owedToYou > 0 || lending.youOwe > 0) && (
              <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
                <Text style={{ fontSize: 13, color: colors.inkMuted, fontWeight: "600" }}>Lend & borrow</Text>
                <Text style={{ fontSize: 12.5, color: colors.inkMuted }}>
                  {`${formatCurrency(lending.owedToYou, currency)} owed to you · ${formatCurrency(lending.youOwe, currency)} you owe`}
                </Text>
              </View>
            )}
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
