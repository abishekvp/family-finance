import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { ChevronLeft, ChevronRight, Pencil, PiggyBank, Plus, Repeat } from "lucide-react";
import { api } from "../api/client";
import type { Budget, Category, RecurringTransaction } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { useAuth } from "../context/AuthContext";
import { useFamilyData } from "../context/FamilyDataContext";
import type { LayoutContext } from "../components/Layout";
import { Badge, Button, Card, Checkbox, Dot, EmptyState, ErrorText, Field, IconButton, Input, Modal, Segmented, SkeletonRows, Toggle, cn } from "../components/ui";
import { Money } from "../components/figures";
import { CategoryPicker } from "../components/CategoryPicker";
import { NewCategoryForm } from "../components/NewCategoryForm";
import { formatCurrency, safePercent } from "../lib/format";
import { MONTH_LABELS } from "../lib/dateUtils";
import { formatDayShort } from "../lib/recurring";
import { budgetName } from "../lib/budgets";

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

export function Budgets() {
  const { family } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const { categories: allCategories, refreshCategories } = useFamilyData();
  const navigate = useNavigate();
  const canWrite = family.role !== "VIEWER";
  const [mode, setMode] = useState<Mode>("monthly");
  const [anchor, setAnchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [budgets, setBudgets] = useState<Budget[]>([]);
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

  const categories = allCategories.filter((c) => c.type === "EXPENSE");

  const load = useCallback(async () => {
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const params =
        mode === "monthly"
          ? { year: anchor.year, month: anchor.month, includeProjected: "1", tzOffset }
          : { year: anchor.year, period: "ANNUAL", includeProjected: "1", tzOffset };
      const [budgetsRes, rulesRes] = await Promise.all([
        api.get<Budget[]>(`/families/${family.id}/budgets`, { params }),
        api.get<RecurringTransaction[]>(`/families/${family.id}/recurring`),
      ]);
      setBudgets(budgetsRes.data);
      setRules(rulesRes.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load budgets"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id, mode, anchor.year, anchor.month]);

  useEffect(() => {
    setIsLoading(true);
    load();
  }, [load]);

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

  function editRule(rule: RecurringTransaction) {
    navigate(`/recurring/${rule.id}`);
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
    mode === "monthly" ? new Date(anchor.year, anchor.month - 1, 1).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : `1 Jan ${anchor.year}`;
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
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
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
        <div className="flex items-center gap-1">
          <IconButton label="Previous period" onClick={() => shift(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <span className="min-w-[140px] text-center text-sm font-bold text-ink">{periodLabel}</span>
          <IconButton label="Next period" onClick={() => shift(1)}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        {canWrite && (
          <Button
            size="sm"
            variant={showAddForm ? "secondary" : "primary"}
            icon={showAddForm ? undefined : <Plus size={14} />}
            onClick={() => {
              setEditing(null);
              setShowAddForm((v) => !v);
            }}
          >
            {showAddForm ? "Cancel" : "Add budget"}
          </Button>
        )}
      </div>

      {!isLoading && budgets.length > 0 && (
        <Card className="space-y-3">
          <div className="grid grid-cols-3 text-center">
            <Summary label="Budgeted" amount={totals.amount} currency={family.currency} />
            <Summary label="Spent" amount={totals.spent} currency={family.currency} tone={totals.spent > totals.amount ? "expense" : undefined} />
            <Summary label="Still to pay" amount={totals.upcoming} currency={family.currency} />
          </div>
          <SpendBar amount={totals.amount} spent={totals.spent} upcoming={totals.upcoming} />
          {totals.upcoming > 0 && (
            <p className="text-xs text-ink-subtle">"Still to pay" is repeating payments due later this {mode === "monthly" ? "month" : "year"}.</p>
          )}
        </Card>
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
          onCategoryCreated={() => refreshCategories().catch(() => undefined)}
          onDone={() => {
            setShowAddForm(false);
            load();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <ErrorText>{error || actionError}</ErrorText>

      {isLoading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : budgets.length === 0 ? (
        <EmptyState icon={<PiggyBank size={20} />} title="No budgets set" description={`Nothing budgeted for ${periodLabel} yet.`} />
      ) : (
        <div className="space-y-3">
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
              <Card key={b.id} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Dot color={b.category.color} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">{budgetName(b)}</p>
                      {budgetName(b) !== b.category.name && <p className="truncate text-xs text-ink-subtle">{b.category.name}</p>}
                    </div>
                    <Badge tone={b.ownerId ? "neutral" : "brand"}>{b.ownerId ? "Personal" : "Family"}</Badge>
                  </div>
                  {b.projected ? (
                    canWrite && (
                      <button type="button" onClick={() => stopRepeating(b)} className="text-xs font-bold text-ink-subtle hover:text-ink">
                        Stop repeating
                      </button>
                    )
                  ) : (
                    canEdit && (
                      <div className="flex shrink-0 items-center gap-3">
                        <button type="button" onClick={() => setEditing(b)} className="text-xs font-bold text-brand-600 hover:underline">
                          Edit
                        </button>
                        {confirmDeleteId === b.id ? (
                          <span className="flex items-center gap-1">
                            <Button size="sm" variant="danger" onClick={() => handleDelete(b.id)}>
                              Confirm
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                              Cancel
                            </Button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmDeleteId(b.id)} className="text-xs font-bold text-ink-subtle hover:text-expense">
                            Delete
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-xs">
                  <span className="text-ink-subtle">
                    <Money amount={b.spent} currency={family.currency} /> of <Money amount={b.amount} currency={family.currency} /> (
                    {safePercent(b.spent, b.amount).toFixed(0)}%)
                  </span>
                  <span className={cn("font-bold", over ? "text-expense" : "text-income")}>
                    {over ? "Over by " : "Left "}
                    <Money amount={Math.abs(b.remaining)} currency={family.currency} />
                  </span>
                </div>
                <SpendBar amount={b.amount} spent={b.spent} upcoming={upcoming} />
                {upcoming > 0 && (
                  <p className="text-xs text-ink-muted">
                    <Money amount={upcoming} currency={family.currency} className="font-bold" /> more due from repeating payments this{" "}
                    {mode === "monthly" ? "month" : "year"}
                  </p>
                )}

                {(inBudget.length > 0 || (!b.projected && canWrite)) && (
                  <div className="space-y-2 border-t border-line pt-3">
                    {inBudget.map((r) => (
                      <div key={r.id} className="flex items-center gap-2">
                        {/* Opens it to change its name, amount, schedule or account. */}
                        <button type="button" onClick={() => editRule(r)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-70">
                          <Repeat size={13} className="shrink-0 text-ink-subtle" />
                          <span className="truncate text-xs text-ink">{`${ruleName(r)} · ${formatCurrency(r.amount, r.account.currency)} · next ${formatDayShort(r.nextDate)}`}</span>
                          {canWrite && <Pencil size={12} className="shrink-0 text-ink-subtle" />}
                        </button>
                        {!b.projected && canMoveRule(r) && (
                          <button type="button" onClick={() => mapRule(b, r, false)} className="text-xs font-bold text-ink-subtle hover:text-expense">
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                    {!b.projected && canWrite && (
                      <button type="button" onClick={() => setAddingToBudget(b)} className="flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:underline">
                        <Plus size={13} />
                        Add a repeating payment
                      </button>
                    )}
                  </div>
                )}

                {(b.projected || b.repeats || b.rollover) && (
                  <p className="text-2xs text-ink-subtle">
                    {[
                      b.projected ? `Added automatically on ${periodStartLabel}` : b.repeats ? `Repeats every ${mode === "monthly" ? "month" : "year"}` : null,
                      b.rollover ? "Rollover on" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <Repeat size={15} className="text-brand-600" />
          <h3 className="flex-1 text-sm font-bold text-ink">{mode === "monthly" ? "Repeating every month" : "Repeating every year"}</h3>
          <Link to="/recurring" className="text-xs font-bold text-brand-600 hover:underline">
            Manage
          </Link>
        </div>
        {periodRules.length === 0 ? (
          <p className="text-sm text-ink-subtle">
            {mode === "monthly"
              ? "Add a salary, rent or subscription under Repeating payments and it counts here every month."
              : "Yearly subscriptions and renewals count toward the yearly budget."}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {periodRules.map((r) => {
              const budget = r.type === "EXPENSE" ? budgetOf(r) : null;
              const placeable = r.type === "EXPENSE" && !budget && canMoveRule(r) && mappableBudgets.length > 0;
              return (
                <li key={r.id} className="flex items-center gap-3">
                  <button type="button" onClick={() => editRule(r)} className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80">
                    <Dot color={r.category?.color ?? "#94A3B8"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{ruleName(r)}</span>
                      <span className={cn("block truncate text-xs", budget || r.type === "INCOME" ? "text-ink-subtle" : "text-warn")}>
                        {[`Next ${formatDayShort(r.nextDate)}`, r.type === "INCOME" ? r.category?.name ?? "Income" : budget ? `In ${budgetName(budget)} budget` : "Not in a budget"].join(" · ")}
                      </span>
                    </span>
                    <Money
                      amount={r.type === "EXPENSE" ? -r.amount : r.amount}
                      currency={r.account.currency}
                      tone={r.type === "EXPENSE" ? "expense" : "income"}
                      signed
                      className="text-sm font-bold"
                    />
                  </button>
                  {placeable && (
                    <button type="button" onClick={() => setPlacingRule(r)} className="shrink-0 text-xs font-bold text-brand-600 hover:underline">
                      Add to budget
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {addingToBudget && (
        <ChoiceModal
          title={`Add to ${budgetName(addingToBudget)}`}
          empty={
            mode === "monthly"
              ? "No other monthly or weekly repeating expenses. Add one under Repeating payments."
              : "No other yearly repeating expenses. Add one under Repeating payments."
          }
          hint="It moves into this budget's category, along with what it already paid this period."
          options={periodExpenseRules
            .filter((r) => canMoveRule(r) && !addingToBudget.recurringIds?.includes(r.id))
            .map((r) => {
              const current = budgetOf(r);
              return {
                key: r.id,
                label: ruleName(r),
                detail: [formatCurrency(r.amount, r.account.currency), current ? `now in ${budgetName(current)}` : r.category?.name ?? "no category"].join(" · "),
                onPick: () => {
                  const target = addingToBudget;
                  setAddingToBudget(null);
                  mapRule(target, r, true);
                },
              };
            })}
          onClose={() => setAddingToBudget(null)}
        />
      )}

      {placingRule && (
        <ChoiceModal
          title={`Count ${ruleName(placingRule)} in`}
          empty="Add a budget first."
          hint="It moves into that budget's category, along with what it already paid this period."
          options={mappableBudgets.map((b) => ({
            key: b.id,
            label: budgetName(b),
            detail: `${b.ownerId ? "Personal" : "Family"} · ${formatCurrency(b.amount, family.currency)}`,
            color: b.category.color,
            onPick: () => {
              const rule = placingRule;
              setPlacingRule(null);
              mapRule(b, rule, true);
            },
          }))}
          onClose={() => setPlacingRule(null)}
        />
      )}
    </div>
  );
}

function ChoiceModal({
  title,
  hint,
  empty,
  options,
  onClose,
}: {
  title: string;
  hint: string;
  empty: string;
  options: { key: string; label: string; detail: string; color?: string; onPick: () => void }[];
  onClose: () => void;
}) {
  return (
    <Modal title={title} description={options.length === 0 ? empty : hint} onClose={onClose}>
      <ul className="space-y-1">
        {options.map((o) => (
          <li key={o.key}>
            <button type="button" onClick={o.onPick} className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition hover:bg-surface-sunken">
              {o.color ? <Dot color={o.color} /> : <Repeat size={15} className="shrink-0 text-ink-subtle" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{o.label}</span>
                <span className="block truncate text-xs text-ink-subtle">{o.detail}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-ink-subtle" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function Summary({ label, amount, currency, tone }: { label: string; amount: number; currency: string; tone?: "expense" }) {
  return (
    <div>
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-ink sm:text-base">
        <Money amount={amount} currency={currency} tone={tone} />
      </p>
    </div>
  );
}

/** Spent (solid) and still-to-pay repeating payments (lighter), against the budget. */
function SpendBar({ amount, spent, upcoming }: { amount: number; spent: number; upcoming: number }) {
  const scale = Math.max(amount, spent + upcoming, 1);
  const over = spent > amount;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
      <div className={cn("h-full transition-[width] duration-500", over ? "bg-expense" : "brand-gradient")} style={{ width: `${(spent / scale) * 100}%` }} />
      <div className="h-full bg-warn opacity-55" style={{ width: `${(upcoming / scale) * 100}%` }} />
    </div>
  );
}

function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <h3 className="mb-4 text-sm font-bold text-ink">{title}</h3>
      <div className="space-y-4">{children}</div>
    </Card>
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
  onCategoryCreated,
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
  onCategoryCreated: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [created, setCreated] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [name, setName] = useState("");
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
        name: name.trim() || null,
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
    <FormCard title={`New ${monthly ? "monthly" : "yearly"} budget`}>
      <Field label="Category">
        {(props) => (
          <>
            {choices.length === 0 && !addingCategory && (
              <p className="mb-2 text-sm text-ink-subtle">All expense categories already have a budget for this {monthly ? "month" : "year"}.</p>
            )}
            <CategoryPicker
              {...props}
              categories={choices}
              selectedId={categoryId}
              onSelect={(id) => id && selectCategory(id)}
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
                  onCategoryCreated();
                }}
                onCancel={() => setAddingCategory(false)}
              />
            )}
          </>
        )}
      </Field>

      {rules.length > 0 && (
        <div>
          <p className="mb-2 text-[0.8125rem] font-medium text-ink-muted">Repeating payments in this budget</p>
          <div className="space-y-2.5">
            {rules.map((r) => {
              const current = budgetOf(r);
              const checked = ruleIds.includes(r.id);
              return (
                <Checkbox
                  key={r.id}
                  checked={checked}
                  onChange={(e) => setRuleIds((ids) => (e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id)))}
                  label={ruleName(r)}
                  description={[formatCurrency(r.amount, r.account.currency), current ? `now in ${budgetName(current)}` : r.category?.name ?? "no category"].join(" · ")}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-subtle">
            {chosenRules.length > 0
              ? `They move into this budget's category. About ${formatCurrency(chosenTotal, chosenRules[0].account.currency)} a ${monthly ? "month" : "year"}.`
              : "Tick the rent, salaries or subscriptions this budget should cover."}
          </p>
          {chosenTotal > 0 && Math.abs(chosenTotal - amountValue) > 0.005 && (
            <button type="button" onClick={() => setAmount(String(Math.round(chosenTotal * 100) / 100))} className="mt-1.5 text-xs font-bold text-brand-600 hover:underline">
              Use their total as the amount ({formatCurrency(chosenTotal, chosenRules[0].account.currency)})
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Optional. Leave blank to use the category's name.">
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder={category?.name ?? "e.g. Groceries & milk"} maxLength={60} />}
        </Field>
        <Field label={monthly ? "Monthly amount" : "Yearly amount"}>
          {(props) => <Input {...props} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />}
        </Field>
      </div>

      <Toggle
        checked={repeats}
        onChange={setRepeats}
        label={monthly ? "Add to upcoming months" : "Repeat every year"}
        description={monthly ? "Carried into each new month when it starts." : "Carried into each new year when it starts."}
      />
      {monthly && <Toggle checked={rollover} onChange={setRollover} label="Roll over unused amount" />}
      <Toggle
        checked={isCommon && !categoryIsPersonal}
        onChange={setIsCommon}
        disabled={categoryIsPersonal}
        label="Family budget"
        description={
          categoryIsPersonal
            ? "Its category is personal, so this budget is personal too."
            : isCommon
              ? "Everyone in the family can see it."
              : "Personal — only you can see it."
        }
      />

      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button loading={isSubmitting} disabled={!canSubmit} onClick={handleSubmit}>
          Add budget
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </FormCard>
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
  const [name, setName] = useState(budget.name ?? "");
  const [amount, setAmount] = useState(String(budget.amount));
  const [rollover, setRollover] = useState(budget.rollover);
  const [repeats, setRepeats] = useState(!!budget.repeats);
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
      await api.patch(`/families/${familyId}/budgets/${budget.id}`, { name: name.trim() || null, amount: amountValue, rollover, repeats, isCommon });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update budget"));
      setIsSubmitting(false);
    }
  }

  return (
    <FormCard title="Edit budget">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint={`Leave blank to use the category's name (${budget.category.name}).${repeats ? ` Later ${monthly ? "months" : "years"} keep it.` : ""}`}>
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder={budget.category.name} maxLength={60} />}
        </Field>
        <Field label={monthly ? "Monthly amount" : "Yearly amount"} hint={repeats ? `Later ${monthly ? "months" : "years"} copy this amount.` : undefined}>
          {(props) => <Input {...props} type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
      </div>
      <Toggle checked={repeats} onChange={setRepeats} label={monthly ? "Add to upcoming months" : "Repeat every year"} />
      {monthly && <Toggle checked={rollover} onChange={setRollover} label="Roll over unused amount" />}
      <Toggle
        checked={isCommon}
        onChange={setIsCommon}
        disabled={categoryIsPersonal && !isCommon}
        label="Family budget"
        description={
          categoryIsPersonal && !isCommon
            ? "Its category is personal — share the category with the family first."
            : isCommon
              ? "Everyone in the family can see it."
              : "Personal — only you can see it."
        }
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button loading={isSubmitting} disabled={!canSubmit} onClick={handleSubmit}>
          Save changes
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </FormCard>
  );
}
