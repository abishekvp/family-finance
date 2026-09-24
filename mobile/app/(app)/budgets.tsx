import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, PiggyBank, Repeat } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Budget, Category, RecurringTransaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, Dot, EmptyState, ErrorText, Field, IconButton, Input, Money, Segmented, SkeletonRows, Toggle } from "../../src/components/ui";
import { safePercent } from "../../src/lib/format";
import { MONTH_LABELS } from "../../src/lib/dateUtils";
import { href } from "../../src/lib/nav";
import { formatDayShort } from "../../src/lib/recurring";
import { CategoryPicker } from "../../src/components/CategoryPicker";

type Mode = "monthly" | "yearly";

export default function Budgets() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("monthly");
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const params =
        mode === "monthly"
          ? { year: anchor.year, month: anchor.month, includeProjected: "1" }
          : { year: anchor.year, period: "ANNUAL", includeProjected: "1" };
      const [budgetsRes, categoriesRes, rulesRes] = await Promise.all([
        api.get<Budget[]>(`/families/${family.id}/budgets`, { params }),
        api.get<Category[]>(`/families/${family.id}/categories`),
        api.get<RecurringTransaction[]>(`/families/${family.id}/recurring`),
      ]);
      setBudgets(budgetsRes.data);
      setCategories(categoriesRes.data.filter((c) => c.type === "EXPENSE"));
      setRules(rulesRes.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load budgets"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id, mode, anchor.year, anchor.month]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await api.delete(`/families/${family.id}/budgets/${id}`);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, "Unable to delete budget"));
    }
  }

  async function stopRepeating(budget: Budget) {
    setActionError(null);
    try {
      await api.patch(`/families/${family.id}/budgets/${budget.sourceId ?? budget.id}`, { repeats: false });
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, "Unable to update budget"));
    }
  }

  function shift(delta: number) {
    setAnchor(({ year, month }) => {
      if (mode === "yearly") return { year: year + delta, month };
      const d = new Date(year, month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }

  const periodLabel = mode === "monthly" ? `${MONTH_LABELS[anchor.month - 1]} ${anchor.year}` : String(anchor.year);
  const periodStartLabel =
    mode === "monthly"
      ? new Date(anchor.year, anchor.month - 1, 1).toLocaleDateString(undefined, { day: "numeric", month: "short" })
      : `1 Jan ${anchor.year}`;
  const budgetedCategoryIds = new Set(budgets.map((b) => b.categoryId));
  const availableCategories = categories.filter((c) => !budgetedCategoryIds.has(c.id));
  const totals = budgets.reduce(
    (acc, b) => ({ amount: acc.amount + b.amount, spent: acc.spent + b.spent, upcoming: acc.upcoming + (b.upcoming ?? 0) }),
    { amount: 0, spent: 0, upcoming: 0 }
  );
  // Repeating payments that belong to this view: monthly and weekly ones in a month, yearly ones in a year.
  const periodRules = rules.filter((r) => r.isActive && (mode === "yearly" ? r.frequency === "YEARLY" : r.frequency !== "YEARLY"));

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Segmented
        fullWidth
        value={mode}
        onChange={(next) => {
          setMode(next);
          setShowAddForm(false);
          setEditing(null);
        }}
        options={[
          { value: "monthly", label: "Monthly" },
          { value: "yearly", label: "Yearly" },
        ]}
      />

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <IconButton onPress={() => shift(-1)}>
          <ChevronLeft size={19} color={colors.inkMuted} />
        </IconButton>
        <Text style={{ fontWeight: "800", fontSize: 15, color: colors.ink, minWidth: 140, textAlign: "center" }}>{periodLabel}</Text>
        <IconButton onPress={() => shift(1)}>
          <ChevronRight size={19} color={colors.inkMuted} />
        </IconButton>
      </View>

      {!isLoading && budgets.length > 0 && (
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Summary label="Budgeted" amount={totals.amount} currency={family.currency} />
            <Summary label="Spent" amount={totals.spent} currency={family.currency} tone={totals.spent > totals.amount ? "expense" : undefined} />
            <Summary label="Still to pay" amount={totals.upcoming} currency={family.currency} />
          </View>
          <SpendBar amount={totals.amount} spent={totals.spent} upcoming={totals.upcoming} />
          {totals.upcoming > 0 && (
            <Text style={{ fontSize: 11.5, color: colors.inkSubtle }}>"Still to pay" is repeating payments due later this {mode === "monthly" ? "month" : "year"}.</Text>
          )}
        </Card>
      )}

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
          mode={mode}
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
      <ErrorText>{actionError}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : budgets.length === 0 ? (
        <EmptyState icon={<PiggyBank size={20} color={colors.brand600} />} title="No budgets set" description={`Nothing budgeted for ${periodLabel} yet.`} />
      ) : (
        <View style={{ gap: 12 }}>
          {budgets.map((b) => {
            if (editing?.id === b.id) {
              return (
                <BudgetEditForm
                  key={b.id}
                  familyId={family.id}
                  mode={mode}
                  budget={b}
                  onDone={() => {
                    setEditing(null);
                    load();
                  }}
                  onCancel={() => setEditing(null)}
                />
              );
            }
            const over = b.spent > b.amount;
            const upcoming = b.upcoming ?? 0;
            return (
              <Card key={b.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Dot color={b.category.color} />
                    <Text style={{ fontWeight: "700", fontSize: 14.5, color: colors.ink }} numberOfLines={1}>
                      {b.category.name}
                    </Text>
                  </View>
                  {b.projected ? (
                    <Pressable onPress={() => stopRepeating(b)} hitSlop={8}>
                      <Text style={{ color: colors.inkSubtle, fontSize: 12, fontWeight: "700" }}>Stop repeating</Text>
                    </Pressable>
                  ) : (
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
                  )}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: colors.inkSubtle }}>
                    <Money amount={b.spent} currency={family.currency} style={{ fontSize: 12, color: colors.inkSubtle }} /> of{" "}
                    <Money amount={b.amount} currency={family.currency} style={{ fontSize: 12, color: colors.inkSubtle }} /> ({safePercent(b.spent, b.amount).toFixed(0)}%)
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: over ? colors.expense : colors.income }}>
                    {over ? "Over by " : "Left "}
                    <Money amount={Math.abs(b.remaining)} currency={family.currency} tone={over ? "expense" : "income"} style={{ fontSize: 12, fontWeight: "700" }} />
                  </Text>
                </View>
                <SpendBar amount={b.amount} spent={b.spent} upcoming={upcoming} />
                {upcoming > 0 && (
                  <Text style={{ fontSize: 11.5, color: colors.inkMuted }}>
                    <Money amount={upcoming} currency={family.currency} style={{ fontSize: 11.5, fontWeight: "700", color: colors.inkMuted }} /> more due from
                    repeating payments this {mode === "monthly" ? "month" : "year"}
                  </Text>
                )}
                {(b.projected || b.repeats || b.rollover) && (
                  <Text style={{ fontSize: 11, color: colors.inkSubtle }}>
                    {[
                      b.projected ? `Added automatically on ${periodStartLabel}` : b.repeats ? `Repeats every ${mode === "monthly" ? "month" : "year"}` : null,
                      b.rollover ? "Rollover on" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                )}
              </Card>
            );
          })}
        </View>
      )}

      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Repeat size={15} color={colors.brand600} />
          <Text style={{ flex: 1, fontWeight: "800", color: colors.ink }}>{mode === "monthly" ? "Repeating every month" : "Repeating every year"}</Text>
          <Pressable onPress={() => router.push(href("/recurring"))} hitSlop={8}>
            <Text style={{ color: colors.brand600, fontSize: 12, fontWeight: "700" }}>Manage</Text>
          </Pressable>
        </View>
        {periodRules.length === 0 ? (
          <Text style={{ fontSize: 12.5, color: colors.inkSubtle }}>
            {mode === "monthly"
              ? "Add a salary, rent or subscription under Repeating payments and it counts here every month."
              : "Yearly subscriptions and renewals count toward the yearly budget."}
          </Text>
        ) : (
          periodRules.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => router.push(href("/recurring-form", { rule: JSON.stringify(r) }))}
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Dot color={r.category?.color ?? colors.inkSubtle} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                  {r.payee || r.category?.name || "Repeating payment"}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.inkSubtle }} numberOfLines={1}>
                  {[`Next ${formatDayShort(r.nextDate)}`, r.category?.name ?? "No category"].join(" · ")}
                </Text>
              </View>
              <Money
                amount={r.type === "EXPENSE" ? -r.amount : r.amount}
                currency={r.account.currency}
                tone={r.type === "EXPENSE" ? "expense" : "income"}
                signed
                style={{ fontSize: 13, fontWeight: "800" }}
              />
            </Pressable>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

function Summary({ label, amount, currency, tone }: { label: string; amount: number; currency: string; tone?: "expense" }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", flex: 1 }}>
      <Text style={{ fontSize: 10, fontWeight: "700", color: colors.inkSubtle, textTransform: "uppercase" }}>{label}</Text>
      <Money amount={amount} currency={currency} tone={tone} style={{ fontWeight: "800", marginTop: 2 }} />
    </View>
  );
}

/** Spent (solid) and still-to-pay repeating payments (lighter), against the budget. */
function SpendBar({ amount, spent, upcoming }: { amount: number; spent: number; upcoming: number }) {
  const { colors } = useTheme();
  const scale = Math.max(amount, spent + upcoming, 1);
  const over = spent > amount;
  return (
    <View style={{ flexDirection: "row", height: 8, borderRadius: 999, overflow: "hidden", backgroundColor: colors.surfaceSunken }}>
      <View style={{ width: `${(spent / scale) * 100}%`, backgroundColor: over ? colors.expense : colors.brand600 }} />
      <View style={{ width: `${(upcoming / scale) * 100}%`, backgroundColor: colors.warn, opacity: 0.55 }} />
    </View>
  );
}

function BudgetForm({
  familyId,
  mode,
  year,
  month,
  categories,
  onDone,
  onCancel,
}: {
  familyId: string;
  mode: Mode;
  year: number;
  month: number;
  categories: Category[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [repeats, setRepeats] = useState(true);
  const [rollover, setRollover] = useState(false);
  const [isCommon, setIsCommon] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const amountValue = Number(amount);
  const canSubmit = !!categoryId && amount.trim().length > 0 && amountValue > 0;
  const monthly = mode === "monthly";

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/budgets`, {
        categoryId,
        amount: amountValue,
        year,
        ...(monthly ? { month, period: "MONTHLY", rollover } : { period: "ANNUAL" }),
        repeats,
        isCommon,
      });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create budget"));
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Field label="Category">
        {categories.length === 0 ? (
          <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>All expense categories already have a budget for this {monthly ? "month" : "year"}.</Text>
        ) : (
          <CategoryPicker categories={categories} selectedId={categoryId} onSelect={setCategoryId} />
        )}
      </Field>

      <Field label={monthly ? "Monthly amount" : "Yearly amount"}>
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" />
      </Field>

      <ToggleRow
        label={monthly ? "Add to upcoming months" : "Repeat every year"}
        hint={monthly ? "Carried into each new month when it starts." : "Carried into each new year when it starts."}
        value={repeats}
        onChange={setRepeats}
      />
      {monthly && <ToggleRow label="Roll over unused amount" value={rollover} onChange={setRollover} />}
      <ToggleRow label="Shared family budget" value={isCommon} onChange={setIsCommon} />

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

function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{label}</Text>
        {hint && <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>{hint}</Text>}
      </View>
      <Toggle value={value} onChange={onChange} />
    </View>
  );
}

function BudgetEditForm({
  familyId,
  mode,
  budget,
  onDone,
  onCancel,
}: {
  familyId: string;
  mode: Mode;
  budget: Budget;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [amount, setAmount] = useState(String(budget.amount));
  const [rollover, setRollover] = useState(budget.rollover);
  const [repeats, setRepeats] = useState(budget.repeats);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const monthly = mode === "monthly";

  const amountValue = Number(amount);
  const canSubmit = amount.trim().length > 0 && amountValue > 0;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.patch(`/families/${familyId}/budgets/${budget.id}`, { amount: amountValue, rollover, repeats });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update budget"));
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Text style={{ fontWeight: "800", color: colors.ink }}>{budget.category.name}</Text>
      <Field label={monthly ? "Monthly amount" : "Yearly amount"} hint={repeats ? `Later ${monthly ? "months" : "years"} copy this amount.` : undefined}>
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      </Field>
      <ToggleRow label={monthly ? "Add to upcoming months" : "Repeat every year"} value={repeats} onChange={setRepeats} />
      {monthly && <ToggleRow label="Roll over unused amount" value={rollover} onChange={setRollover} />}
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
