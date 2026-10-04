import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, PiggyBank, Plus, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import {
  Button,
  Card,
  CardHeader,
  Dot,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  Modal,
  ProgressBar,
  Select,
  SkeletonRows,
  Toggle,
} from "../ui";
import { Money } from "../figures";
import type { Budget, Category } from "../../api/types";
import { MONTH_LABELS } from "../../lib/dateUtils";


/** A budget's own name if it has one, else its category's. */
function budgetLabel(budget: Budget) {
  return budget.name?.trim() || budget.category.name;
}

export function BudgetManager({ familyId, currency }: { familyId: string; currency: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [period, setPeriod] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Budget | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const params: any = { year, tzOffset: new Date().getTimezoneOffset() };
      if (period === "MONTHLY") params.month = month;
      else params.period = "ANNUAL";
      const [budgetsRes, categoriesRes] = await Promise.all([
        api.get<Budget[]>(`/families/${familyId}/budgets`, { params }),
        api.get<Category[]>(`/families/${familyId}/categories`),
      ]);
      setBudgets(budgetsRes.data);
      setCategories(categoriesRes.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load budgets"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, year, month, period]);

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === "EXPENSE"), [categories]);
  const budgetedCategoryIds = useMemo(() => new Set(budgets.map((b) => b.categoryId)), [budgets]);
  const availableCategories = useMemo(
    () => expenseCategories.filter((c) => !budgetedCategoryIds.has(c.id)),
    [expenseCategories, budgetedCategoryIds]
  );

  const summary = useMemo(
    () => ({
      budgeted: budgets.reduce((s, b) => s + b.amount, 0),
      spent: budgets.reduce((s, b) => s + b.spent, 0),
    }),
    [budgets]
  );

  async function handleDelete(budgetId: string) {
    setDeleteError(null);
    try {
      await api.delete(`/families/${familyId}/budgets/${budgetId}`);
      setDeletingId(null);
      await load();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Unable to delete budget"));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Budgets"
        subtitle={budgets.length > 0 ? (period === "MONTHLY" ? `${MONTH_LABELS[month - 1]} ${year}` : `${year}`) : undefined}
        icon={<PiggyBank size={17} />}
        actions={
          <>
            <Select value={period} onChange={(e) => setPeriod(e.target.value as any)} className="!h-9 !text-xs">
              <option value="MONTHLY">Monthly</option>
              <option value="ANNUAL">Yearly</option>
            </Select>
            {period === "MONTHLY" && (
              <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="!h-9 !text-xs">
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
            <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="!h-9 !text-xs">
              {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
              Add
            </Button>
          </>
        }
      />

      <ErrorText>{error || deleteError}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : budgets.length === 0 ? (
        <EmptyState
          title="No budgets for this month"
          description="Add a budget to track spending against a category."
          icon={<PiggyBank size={18} />}
        />
      ) : (
        <>
          {summary.budgeted > 0 && (
            <div className="mb-4 rounded-xl bg-surface-sunken/60 px-3.5 py-2.5 text-xs">
              <div className="mb-1.5 flex items-center justify-between font-semibold text-ink">
                <span>
                  <Money amount={summary.spent} currency={currency} /> of{" "}
                  <Money amount={summary.budgeted} currency={currency} /> spent
                </span>
                <span className={summary.spent > summary.budgeted ? "text-expense" : "text-ink-subtle"}>
                  {summary.budgeted > 0 ? Math.round((summary.spent / summary.budgeted) * 100) : 0}%
                </span>
              </div>
              <ProgressBar
                value={summary.budgeted > 0 ? summary.spent / summary.budgeted : 0}
                tone={summary.spent > summary.budgeted ? "expense" : "brand"}
              />
            </div>
          )}

          <ul className="divide-y divide-line">
            {budgets.map((budget) => {
              const pct = budget.amount > 0 ? budget.spent / budget.amount : 0;
              const over = budget.spent > budget.amount;
              const remaining = budget.amount - budget.spent;
              return (
                <li key={budget.id} className="py-3.5">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                      <Dot color={budget.category.color} />
                      <span className="truncate">{budgetLabel(budget)}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <IconButton label={`Edit ${budgetLabel(budget)} budget`} onClick={() => setEditing(budget)}>
                        <Pencil size={14} />
                      </IconButton>
                      {deletingId === budget.id ? (
                        <span className="flex items-center gap-1.5">
                          <Button size="sm" variant="danger" onClick={() => handleDelete(budget.id)}>
                            Confirm
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeletingId(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <IconButton
                          label={`Delete ${budgetLabel(budget)} budget`}
                          tone="danger"
                          onClick={() => setDeletingId(budget.id)}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      )}
                    </span>
                  </div>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className={over ? "tnum text-expense" : "tnum text-ink-subtle"}>
                      <Money amount={budget.spent} currency={currency} /> / <Money amount={budget.amount} currency={currency} />
                    </span>
                    <span className={over ? "font-semibold text-expense" : "text-ink-subtle"}>
                      {over ? (
                        <>
                          <Money amount={Math.abs(remaining)} currency={currency} /> over
                        </>
                      ) : (
                        <>
                          <Money amount={remaining} currency={currency} /> left
                        </>
                      )}
                    </span>
                  </div>
                  <ProgressBar value={pct} tone={over ? "expense" : "brand"} />
                  {budget.rollover && <p className="mt-1.5 text-2xs text-ink-subtle">Rollover on</p>}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {editing && (
        <BudgetFormModal
          familyId={familyId}
          year={year}
          month={month}
          period={period}
          budget={editing === "new" ? null : editing}
          categories={editing === "new" ? availableCategories : expenseCategories}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </Card>
  );
}

function BudgetFormModal({
  familyId,
  year,
  month,
  period,
  budget,
  categories,
  onClose,
  onSaved,
}: {
  familyId: string;
  year: number;
  month: number;
  period: "MONTHLY" | "ANNUAL";
  budget: Budget | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(budget);
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? categories[0]?.id ?? "");
  const [name, setName] = useState(budget?.name ?? "");
  const [amount, setAmount] = useState(budget ? String(budget.amount) : "");
  const [rollover, setRollover] = useState(budget?.rollover ?? false);
  const [isCommon, setIsCommon] = useState(budget ? budget.ownerId === null : false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && budget) {
        await api.patch(`/families/${familyId}/budgets/${budget.id}`, {
          name: name.trim() || null,
          amount: Number(amount) || 0,
          rollover,
          isCommon,
        });
      } else {
        await api.post(`/families/${familyId}/budgets`, {
          categoryId,
          name: name.trim() || null,
          amount: Number(amount) || 0,
          year,
          month: period === "MONTHLY" ? month : undefined,
          period,
          rollover,
          isCommon,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save budget"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Edit budget" : "Add budget"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="budget-form"
            loading={isSubmitting}
            disabled={(!isEdit && !categoryId) || !amount}
          >
            Save
          </Button>
        </div>
      }
    >
      <form id="budget-form" onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <Field label="Category">
            {(props) =>
              categories.length === 0 ? (
                <p className="text-sm text-ink-subtle">All expense categories already have a budget for this {period === "MONTHLY" ? "month" : "year"}.</p>
              ) : (
                <Select {...props} required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )
            }
          </Field>
        )}
        <Field label="Name" hint="Optional. Leave blank to use the category's name.">
          {(props) => (
            <Input
              {...props}
              maxLength={60}
              placeholder={budget?.category.name ?? categories.find((c) => c.id === categoryId)?.name ?? ""}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={period === "MONTHLY" ? "Monthly amount" : "Yearly amount"}>
          {(props) => (
            <Input
              {...props}
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <Toggle checked={rollover} onChange={setRollover} label="Roll over unused amount" description="Carries leftover budget into next month." />
        <Toggle checked={isCommon} onChange={setIsCommon} label="Shared family budget" description="Tracked against shared spending." />
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}
