import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight, PiggyBank, Plus, Repeat } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Budget, Category, RecurringTransaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Dot,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  Money,
  Segmented,
  Sheet,
  SkeletonRows,
  Toggle,
} from "../../src/components/ui";
import { formatCurrency, safePercent } from "../../src/lib/format";
import { MONTH_LABELS } from "../../src/lib/dateUtils";
import { href } from "../../src/lib/nav";
import { formatDayShort } from "../../src/lib/recurring";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { NewCategoryForm } from "../../src/components/NewCategoryForm";

type Mode = "monthly" | "yearly";

/** Monthly budgets hold weekly and monthly payments; yearly budgets hold yearly ones. */
function belongsToMode(rule: RecurringTransaction, mode: Mode) {
  return mode === "yearly" ? rule.frequency === "YEARLY" : rule.frequency !== "YEARLY";
}

/** What a repeating payment costs over a budget's period (a weekly one, about 52/12 times a month). */
function perPeriod(rule: RecurringTransaction) {
  return rule.frequency === "WEEKLY" ? (rule.amount * 52) / 12 : rule.amount;
}

function ruleName(rule: RecurringTransaction) {
  return rule.payee || rule.category?.name || "Repeating payment";
}

export default function Budgets() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const router = useRouter();
  const canWrite = family.role !== "VIEWER";
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
  // Adding a repeating payment to a budget, or a budget to a repeating payment.
  const [addingToBudget, setAddingToBudget] = useState<Budget | null>(null);
  const [placingRule, setPlacingRule] = useState<RecurringTransaction | null>(null);

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

  /** Counts a repeating payment in a budget (it moves into the budget's category), or takes it out. */
  async function mapRule(budget: Budget, rule: RecurringTransaction, include: boolean) {
    setActionError(null);
    try {
      const url = `/families/${family.id}/budgets/${budget.id}/recurring/${rule.id}`;
      if (include) await api.put(url);
      else await api.delete(url);
      await load();
    } catch (err) {
      setActionError(getErrorMessage(err, include ? "Unable to add it to the budget" : "Unable to take it out of the budget"));
    }
  }

  function shift(delta: number) {
    setAnchor(({ year, month }) => {
      if (mode === "yearly") return { year: year + delta, month };
      const d = new Date(year, month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  }

  /** Only the one who set it up (or an admin) can move a repeating payment. */
  const canMoveRule = (rule: RecurringTransaction) => canWrite && (family.role === "ADMIN" || rule.userId === user!.id);

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
  // Repeating expenses that belong to this view: monthly and weekly ones in a month, yearly ones in a year.
  const periodRules = rules.filter((r) => r.isActive && belongsToMode(r, mode));
  const periodExpenseRules = periodRules.filter((r) => r.type === "EXPENSE");
  const budgetOf = (rule: RecurringTransaction) => budgets.find((b) => b.recurringIds?.includes(rule.id)) ?? null;
  // Budgets a payment can be put in: real ones (a future month's preview isn't saved yet).
  const mappableBudgets = budgets.filter((b) => !b.projected);

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

      {canWrite && (
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
      )}

      {showAddForm && (
        <BudgetForm
          familyId={family.id}
          mode={mode}
          year={anchor.year}
          month={anchor.month}
          categories={availableCategories}
          allCategories={categories}
          rules={periodExpenseRules.filter(canMoveRule)}
          budgetOf={budgetOf}
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
                  categoryIsPersonal={!!categories.find((c) => c.id === b.categoryId)?.ownerId}
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
            const inBudget = rules.filter((r) => b.recurringIds?.includes(r.id));
            // Only its owner (or an admin, for a family budget) changes a budget.
            const canEdit = canWrite && !b.projected && (b.ownerId ? b.ownerId === user!.id : family.role === "ADMIN");
            return (
              <Card key={b.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Dot color={b.category.color} />
                    <Text style={{ fontWeight: "700", fontSize: 14.5, color: colors.ink, flexShrink: 1 }} numberOfLines={1}>
                      {b.category.name}
                    </Text>
                    <Badge tone={b.ownerId ? "neutral" : "brand"}>{b.ownerId ? "Personal" : "Family"}</Badge>
                  </View>
                  {b.projected ? (
                    canWrite && (
                      <Pressable onPress={() => stopRepeating(b)} hitSlop={8}>
                        <Text style={{ color: colors.inkSubtle, fontSize: 12, fontWeight: "700" }}>Stop repeating</Text>
                      </Pressable>
                    )
                  ) : (
                    canEdit && (
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
                    )
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

                {(inBudget.length > 0 || (!b.projected && canWrite)) && (
                  <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
                    {inBudget.map((r) => (
                      <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Repeat size={13} color={colors.inkSubtle} />
                        <Text style={{ flex: 1, fontSize: 12.5, color: colors.ink }} numberOfLines={1}>
                          {`${ruleName(r)} · ${formatCurrency(r.amount, r.account.currency)} · next ${formatDayShort(r.nextDate)}`}
                        </Text>
                        {!b.projected && canMoveRule(r) && (
                          <Pressable onPress={() => mapRule(b, r, false)} hitSlop={8}>
                            <Text style={{ color: colors.inkSubtle, fontSize: 12, fontWeight: "700" }}>Remove</Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                    {!b.projected && canWrite && (
                      <Pressable onPress={() => setAddingToBudget(b)} hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Plus size={13} color={colors.brand600} />
                        <Text style={{ color: colors.brand600, fontSize: 12.5, fontWeight: "700" }}>Add a repeating payment</Text>
                      </Pressable>
                    )}
                  </View>
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
          periodRules.map((r) => {
            const budget = r.type === "EXPENSE" ? budgetOf(r) : null;
            const placeable = r.type === "EXPENSE" && !budget && canMoveRule(r) && mappableBudgets.length > 0;
            return (
              <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable
                  onPress={() => router.push(href("/recurring-form", { rule: JSON.stringify(r) }))}
                  style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }}
                >
                  <Dot color={r.category?.color ?? colors.inkSubtle} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                      {ruleName(r)}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: budget || r.type === "INCOME" ? colors.inkSubtle : colors.warn }} numberOfLines={1}>
                      {[
                        `Next ${formatDayShort(r.nextDate)}`,
                        r.type === "INCOME" ? r.category?.name ?? "Income" : budget ? `In ${budget.category.name} budget` : "Not in a budget",
                      ].join(" · ")}
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
                {placeable && (
                  <Pressable onPress={() => setPlacingRule(r)} hitSlop={8}>
                    <Text style={{ color: colors.brand600, fontSize: 12, fontWeight: "700" }}>Add to budget</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </Card>

      <ChoiceSheet
        visible={!!addingToBudget}
        title={addingToBudget ? `Add to ${addingToBudget.category.name}` : ""}
        empty={
          mode === "monthly"
            ? "No other monthly or weekly repeating expenses. Add one under Repeating payments."
            : "No other yearly repeating expenses. Add one under Repeating payments."
        }
        hint="It moves into this budget's category, along with what it already paid this period."
        options={periodExpenseRules
          .filter((r) => canMoveRule(r) && !addingToBudget?.recurringIds?.includes(r.id))
          .map((r) => {
            const current = budgetOf(r);
            return {
              key: r.id,
              label: ruleName(r),
              detail: [formatCurrency(r.amount, r.account.currency), current ? `now in ${current.category.name}` : r.category?.name ?? "no category"].join(" · "),
              onPress: () => {
                const target = addingToBudget!;
                setAddingToBudget(null);
                mapRule(target, r, true);
              },
            };
          })}
        onClose={() => setAddingToBudget(null)}
      />

      <ChoiceSheet
        visible={!!placingRule}
        title={placingRule ? `Count ${ruleName(placingRule)} in` : ""}
        empty="Add a budget first."
        hint="It moves into that budget's category, along with what it already paid this period."
        options={mappableBudgets.map((b) => ({
          key: b.id,
          label: b.category.name,
          detail: `${b.ownerId ? "Personal" : "Family"} · ${formatCurrency(b.amount, family.currency)}`,
          color: b.category.color,
          onPress: () => {
            const rule = placingRule!;
            setPlacingRule(null);
            mapRule(b, rule, true);
          },
        }))}
        onClose={() => setPlacingRule(null)}
      />
    </ScrollView>
  );
}

function ChoiceSheet({
  visible,
  title,
  hint,
  empty,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  hint: string;
  empty: string;
  options: { key: string; label: string; detail: string; color?: string; onPress: () => void }[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 4, paddingBottom: 12 }}>
        <Text style={{ fontSize: 12, color: colors.inkSubtle, marginBottom: 6 }}>{options.length === 0 ? empty : hint}</Text>
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={o.onPress}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 12,
              paddingHorizontal: 4,
              borderRadius: 12,
              backgroundColor: pressed ? colors.surfaceSunken : "transparent",
            })}
          >
            {o.color ? <Dot color={o.color} /> : <Repeat size={15} color={colors.inkSubtle} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                {o.label}
              </Text>
              <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }} numberOfLines={1}>
                {o.detail}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.inkSubtle} />
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
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
  allCategories,
  rules,
  budgetOf,
  onDone,
  onCancel,
}: {
  familyId: string;
  mode: Mode;
  year: number;
  month: number;
  /** Expense categories without a budget in this period yet. */
  categories: Category[];
  allCategories: Category[];
  /** Repeating expenses of this period the user may move into the new budget. */
  rules: RecurringTransaction[];
  budgetOf: (rule: RecurringTransaction) => Budget | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [created, setCreated] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [amount, setAmount] = useState("");
  const [repeats, setRepeats] = useState(true);
  const [rollover, setRollover] = useState(false);
  const [isCommon, setIsCommon] = useState(false);
  const [ruleIds, setRuleIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const choices = [...categories, ...created];
  const category = choices.find((c) => c.id === categoryId) ?? null;
  // A family budget on a category only you can see would show others an unnamed budget.
  const categoryIsPersonal = !!category?.ownerId;
  const amountValue = Number(amount);
  const canSubmit = !!categoryId && amount.trim().length > 0 && amountValue > 0;
  const monthly = mode === "monthly";
  const chosenRules = rules.filter((r) => ruleIds.includes(r.id));
  const chosenTotal = chosenRules.reduce((sum, r) => sum + perPeriod(r), 0);

  function selectCategory(id: string) {
    setCategoryId(id);
    // Payments already in this category count anyway; start with them ticked.
    setRuleIds((ids) => [...new Set([...ids, ...rules.filter((r) => r.categoryId === id).map((r) => r.id)])]);
  }

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
        isCommon: isCommon && !categoryIsPersonal,
        recurringIds: ruleIds,
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
        <View style={{ gap: 12 }}>
          {choices.length === 0 && !addingCategory ? (
            <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>All expense categories already have a budget for this {monthly ? "month" : "year"}.</Text>
          ) : null}
          <CategoryPicker
            categories={choices}
            selectedId={categoryId}
            onSelect={selectCategory}
            onAddNew={addingCategory ? undefined : () => setAddingCategory(true)}
          />
          {addingCategory && (
            <NewCategoryForm
              familyId={familyId}
              type="EXPENSE"
              taken={allCategories}
              onCreated={(c) => {
                setCreated((list) => [...list, c]);
                selectCategory(c.id);
                setAddingCategory(false);
              }}
              onCancel={() => setAddingCategory(false)}
            />
          )}
        </View>
      </Field>

      {rules.length > 0 && (
        <Field
          label="Repeating payments in this budget"
          hint={
            chosenRules.length > 0
              ? `They move into this budget's category. About ${formatCurrency(chosenTotal, chosenRules[0].account.currency)} a ${monthly ? "month" : "year"}.`
              : "Tick the rent, salaries or subscriptions this budget should cover."
          }
        >
          <View style={{ gap: 10 }}>
            {rules.map((r) => {
              const current = budgetOf(r);
              const checked = ruleIds.includes(r.id);
              return (
                <Pressable
                  key={r.id}
                  onPress={() => setRuleIds((ids) => (checked ? ids.filter((id) => id !== r.id) : [...ids, r.id]))}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
                >
                  <Checkbox checked={checked} onChange={(next) => setRuleIds((ids) => (next ? [...ids, r.id] : ids.filter((id) => id !== r.id)))} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }} numberOfLines={1}>
                      {ruleName(r)}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.inkSubtle }} numberOfLines={1}>
                      {[formatCurrency(r.amount, r.account.currency), current ? `now in ${current.category.name}` : r.category?.name ?? "no category"].join(" · ")}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {chosenTotal > 0 && Math.abs(chosenTotal - amountValue) > 0.005 && (
              <Pressable onPress={() => setAmount(String(Math.round(chosenTotal * 100) / 100))} hitSlop={6}>
                <Text style={{ color: colors.brand600, fontSize: 12.5, fontWeight: "700" }}>
                  Use their total as the amount ({formatCurrency(chosenTotal, chosenRules[0].account.currency)})
                </Text>
              </Pressable>
            )}
          </View>
        </Field>
      )}

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
      <ToggleRow
        label="Family budget"
        hint={
          categoryIsPersonal
            ? "Its category is personal, so this budget is personal too."
            : isCommon
              ? "Everyone in the family can see it."
              : "Personal — only you can see it."
        }
        value={isCommon && !categoryIsPersonal}
        onChange={setIsCommon}
        disabled={categoryIsPersonal}
      />

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

function ToggleRow({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{label}</Text>
        {hint && <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>{hint}</Text>}
      </View>
      <Toggle value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

function BudgetEditForm({
  familyId,
  mode,
  budget,
  categoryIsPersonal,
  onDone,
  onCancel,
}: {
  familyId: string;
  mode: Mode;
  budget: Budget;
  categoryIsPersonal: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [amount, setAmount] = useState(String(budget.amount));
  const [rollover, setRollover] = useState(budget.rollover);
  const [repeats, setRepeats] = useState(budget.repeats);
  const [isCommon, setIsCommon] = useState(budget.ownerId === null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const monthly = mode === "monthly";

  const amountValue = Number(amount);
  const canSubmit = amount.trim().length > 0 && amountValue > 0;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.patch(`/families/${familyId}/budgets/${budget.id}`, { amount: amountValue, rollover, repeats, isCommon });
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
      <ToggleRow
        label="Family budget"
        hint={
          categoryIsPersonal && !isCommon
            ? "Its category is personal — share the category with the family first."
            : isCommon
              ? "Everyone in the family can see it."
              : "Personal — only you can see it."
        }
        value={isCommon}
        onChange={setIsCommon}
        disabled={categoryIsPersonal && !isCommon}
      />
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
