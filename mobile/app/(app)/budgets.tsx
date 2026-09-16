import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../../src/api/client";
import type { Budget, Category } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors, pillStyle, pillTextStyle } from "../../src/components/ui";
import { formatCurrency, safePercent } from "../../src/lib/format";
import { MONTH_LABELS } from "../../src/lib/dateUtils";
import { CategoryPicker } from "../../src/components/CategoryPicker";

export default function Budgets() {
  const { user } = useAuth();
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
    <ScrollView style={{ backgroundColor: colors.slate50 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 }}>
        <Pressable hitSlop={10} onPress={() => shiftMonth(-1)}>
          <Text style={{ fontSize: 18, color: colors.slate500 }}>‹</Text>
        </Pressable>
        <Text style={{ fontWeight: "700", fontSize: 15 }}>
          {MONTH_LABELS[anchor.month - 1]} {anchor.year}
        </Text>
        <Pressable hitSlop={10} onPress={() => shiftMonth(1)}>
          <Text style={{ fontSize: 18, color: colors.slate500 }}>›</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button
          title={showAddForm ? "Cancel" : "Add budget"}
          variant="secondary"
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
        <ActivityIndicator color={colors.brand600} size="large" style={{ marginTop: 40 }} />
      ) : budgets.length === 0 ? (
        <Card>
          <Text style={{ color: colors.slate400, fontSize: 13, textAlign: "center" }}>
            No budgets set for {MONTH_LABELS[anchor.month - 1]} {anchor.year} yet.
          </Text>
        </Card>
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
                  <Text style={{ fontWeight: "600", fontSize: 15 }}>{b.category.name}</Text>
                  <View style={{ flexDirection: "row", gap: 14 }}>
                    <Pressable onPress={() => setEditing(b)} hitSlop={8}>
                      <Text style={{ color: colors.brand600, fontSize: 12, fontWeight: "600" }}>Edit</Text>
                    </Pressable>
                    {confirmDeleteId === b.id ? (
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <Pressable onPress={() => handleDelete(b.id)} hitSlop={8}>
                          <Text style={{ color: colors.red600, fontSize: 12, fontWeight: "700" }}>Confirm</Text>
                        </Pressable>
                        <Pressable onPress={() => setConfirmDeleteId(null)} hitSlop={8}>
                          <Text style={{ color: colors.slate500, fontSize: 12 }}>Cancel</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable onPress={() => setConfirmDeleteId(b.id)} hitSlop={8}>
                        <Text style={{ color: colors.slate400, fontSize: 12, fontWeight: "600" }}>Delete</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: colors.slate500 }}>
                    {formatCurrency(b.spent, family.currency)} of {formatCurrency(b.amount, family.currency)}
                  </Text>
                  <Text style={{ fontSize: 12, color: over ? colors.red600 : colors.green600, fontWeight: "600" }}>
                    {over ? "Over by " : "Remaining "}
                    {formatCurrency(Math.abs(b.remaining), family.currency)}
                  </Text>
                </View>
                <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.slate200, overflow: "hidden" }}>
                  <View style={{ width: `${pct}%`, height: "100%", backgroundColor: over ? colors.red600 : colors.brand600 }} />
                </View>
                {b.rollover && <Text style={{ fontSize: 11, color: colors.slate400 }}>Rollover enabled</Text>}
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
      await api.post(`/families/${familyId}/budgets`, {
        categoryId,
        amount: amountValue,
        year,
        month,
        period: "MONTHLY",
        rollover,
        isCommon,
      });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create budget"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Label>Category</Label>
        {categories.length === 0 ? (
          <Text style={{ color: colors.slate400, fontSize: 13 }}>
            All expense categories already have a budget this month.
          </Text>
        ) : (
          <CategoryPicker categories={categories} selectedId={categoryId} onSelect={setCategoryId} />
        )}
      </View>

      <View>
        <Label>Monthly amount</Label>
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Label>Roll over unused amount</Label>
        <Switch value={rollover} onValueChange={setRollover} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Label>Shared family budget</Label>
        <Pressable onPress={() => setIsCommon((v) => !v)} style={[pillStyle(isCommon), { paddingHorizontal: 16 }]}>
          <Text style={pillTextStyle(isCommon)}>{isCommon ? "Shared" : "Private"}</Text>
        </Pressable>
      </View>

      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title={isSubmitting ? "Saving..." : "Add budget"} onPress={handleSubmit} disabled={isSubmitting || !canSubmit} />
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
    <Card style={{ gap: 12 }}>
      <Text style={{ fontWeight: "700" }}>{budget.category.name}</Text>
      <View>
        <Label>Monthly amount</Label>
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Label>Roll over unused amount</Label>
        <Switch value={rollover} onValueChange={setRollover} />
      </View>
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title={isSubmitting ? "Saving..." : "Save changes"} onPress={handleSubmit} disabled={isSubmitting || !canSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
