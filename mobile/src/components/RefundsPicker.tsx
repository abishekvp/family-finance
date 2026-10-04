import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Transaction } from "../api/types";
import { useTheme } from "../context/ThemeContext";
import { Chip, Input } from "./ui";
import { currencySymbol } from "../lib/format";

export function RefundsPicker({
  expenses,
  selectedId,
  onSelect,
  familyCurrency,
  maxHeight = 260,
}: {
  expenses: Transaction[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  familyCurrency: string;
  maxHeight?: number;
}) {
  const { colors } = useTheme();
  const [search, setSearch] = useState("");

  const lowerSearch = search.trim().toLowerCase();
  const filteredExpenses = lowerSearch
    ? expenses.filter((e) =>
        (e.payee || "Expense").toLowerCase().includes(lowerSearch) ||
        String(e.amount).includes(lowerSearch)
      )
    : expenses;

  if (expenses.length === 0) {
    return null;
  }

  return (
    <View style={{ gap: 12 }}>
      <Input
        placeholder="Search expenses..."
        value={search}
        onChangeText={setSearch}
      />
      <ScrollView style={{ maxHeight }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="Not a refund" selected={!selectedId} onPress={() => onSelect(null)} />
          {filteredExpenses.map((expense) => (
            <Chip
              key={expense.id}
              label={`${expense.date.slice(5, 10)} - ${expense.payee || "Expense"} (${currencySymbol(familyCurrency)}${expense.amount})`}
              selected={selectedId === expense.id}
              onPress={() => onSelect(expense.id)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
