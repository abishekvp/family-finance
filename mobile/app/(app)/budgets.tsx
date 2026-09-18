import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ChevronLeft, ChevronRight, PiggyBank } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Budget, Category } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, Dot, EmptyState, ErrorText, Field, IconButton, Input, Money, ProgressBar, SkeletonRows, Toggle } from "../../src/components/ui";
import { safePercent } from "../../src/lib/format";
import { MONTH_LABELS } from "../../src/lib/dateUtils";
import { CategoryPicker } from "../../src/components/CategoryPicker";

export default function Budgets() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [budgetsRes, categoriesRes] = await Promise.all([
        api.get<Budget[]>(`/families/${family.id}/budgets`, { params: { year: anchor.year, month: anchor.month } }),
        api.get<Category[]>(`/families/${family.id}/categories`),
      ]);
      setBudgets(budgetsRes.data);
      setCategories(categoriesRes.data.filter((c) => c.type === "EXPENSE"));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load budgets"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id, anchor.year, anchor.month]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await api.delete(`/families/${family.id}/budgets/${id}`);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Unable to delete budget"));
    }
  }

  function shiftMonth(delta: number) {
    setAnchor(({ year, month }) => {
      const d = new Date(year, month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }

  const budgetedCategoryIds = new Set(budgets.map((b) => b.categoryId));
  const availableCategories = categories.filter((c) => !budgetedCategoryIds.has(c.id));

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <IconButton onPress={() => shiftMonth(-1)}>
          <ChevronLeft size={19} color={colors.inkMuted} />
        </IconButton>
        <Text style={{ fontWeight: "800", fontSize: 15, color: colors.ink, minWidth: 140, textAlign: "center" }}>
          {MONTH_LABELS[anchor.month - 1]} {anchor.year}
        </Text>
        <IconButton onPress={() => shiftMonth(1)}>
          <ChevronRight size={19} color={colors.inkMuted} />
        </IconButton>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button
          title={showAddForm ? "Cancel" : "Add budget"}
          variant="secondary"
          size="sm"
          onPress={() => {
            setEditing(null);
            setShowAddForm((v) => !v);
          }}
        />
      </View>

      {showAddForm && (
        <BudgetForm
          familyId={family.id}
          year={anchor.year}
          month={anchor.month}
          categories={availableCategories}
          onDone={() => {
            setShowAddForm(false);
            load();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <ErrorText>{error}</ErrorText>
      <ErrorText>{deleteError}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : budgets.length === 0 ? (
        <EmptyState icon={<PiggyBank size={20} color={colors.brand600} />} title="No budgets set" description={`Nothing budgeted for ${MONTH_LABELS[anchor.month - 1]} ${anchor.year} yet.`} />
      ) : (
        <View style={{ gap: 12 }}>
          {budgets.map((b) => {
            if (editing?.id === b.id) {
              return (
                <BudgetEditForm
                  key={b.id}
                  familyId={family.id}
                  budget={b}
                  onDone={() => {
                    setEditing(null);
                    load();
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            const pct = safePercent(b.spent, b.amount);
            const over = b.spent > b.amount;
            return (
              <Card key={b.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Dot color={b.category.color} />
                    <Text style={{ fontWeight: "700", fontSize: 14.5, color: colors.ink }} numberOfLines={1}>
                      {b.category.name}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 14 }}>
                    <Pressable onPress={() => setEditing(b)} hitSlop={8}>
                      <Text style={{ color: colors.brand600, fontSize: 12, fontWeight: "700" }}>Edit</Text>
                    </Pressable>
                    {confirmDeleteId === b.id ? (
                      <Button title="Confirm" size="sm" variant="danger" onPress={() => handleDelete(b.id)} />
                    ) : (
                      <Pressable onPress={() => setConfirmDeleteId(b.id)} hitSlop={8}>
                        <Text style={{ color: colors.inkSubtle, fontSize: 12, fontWeight: "700" }}>Delete</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: colors.inkSubtle }}>
                    {safePercent(b.spent, b.amount).toFixed(0)}% used
                  </Text>
                  <Text style={{ fontSize: 12, color: over ? colors.expense : colors.income, fontWeight: "700" }}>
                    {over ? "Over by " : "Remaining "}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Money amount={b.spent} currency={family.currency} style={{ fontSize: 12, color: colors.inkSubtle }} />
                  <Money amount={Math.abs(b.remaining)} currency={family.currency} tone={over ? "expense" : "income"} style={{ fontSize: 12, fontWeight: "700" }} />
                </View>
                <ProgressBar value={pct / 100} tone={over ? "expense" : "brand"} />
                {b.rollover && <Text style={{ fontSize: 11, color: colors.inkSubtle }}>Rollover enabled</Text>}
              </Card>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

function BudgetForm({
  familyId,
  year,
  month,
  categories,
  onDone,
  onCancel,
}: {
  familyId: string;
  year: number;
  month: number;
  categories: Category[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [rollover, setRollover] = useState(false);
  const [isCommon, setIsCommon] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const amountValue = Number(amount);
  const canSubmit = !!categoryId && amount.trim().length > 0 && amountValue > 0;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/budgets`, { categoryId, amount: amountValue, year, month, period: "MONTHLY", rollover, isCommon });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create budget"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Field label="Category">
        {categories.length === 0 ? (
          <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>All expense categories already have a budget this month.</Text>
        ) : (
          <CategoryPicker categories={categories} selectedId={categoryId} onSelect={setCategoryId} />
        )}
      </Field>

      <Field label="Monthly amount">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" />
      </Field>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Roll over unused amount</Text>
        <Toggle value={rollover} onChange={setRollover} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Shared family budget</Text>
        <Toggle value={isCommon} onChange={setIsCommon} />
      </View>

      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Add budget" loading={isSubmitting} disabled={!canSubmit} onPress={handleSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}

function BudgetEditForm({
  familyId,
  budget,
  onDone,
  onCancel,
}: {
  familyId: string;
  budget: Budget;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [amount, setAmount] = useState(String(budget.amount));
  const [rollover, setRollover] = useState(budget.rollover);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const amountValue = Number(amount);
  const canSubmit = amount.trim().length > 0 && amountValue > 0;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.patch(`/families/${familyId}/budgets/${budget.id}`, { amount: amountValue, rollover });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update budget"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Text style={{ fontWeight: "800", color: colors.ink }}>{budget.category.name}</Text>
      <Field label="Monthly amount">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      </Field>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Roll over unused amount</Text>
        <Toggle value={rollover} onChange={setRollover} />
      </View>
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Save changes" loading={isSubmitting} disabled={!canSubmit} onPress={handleSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
