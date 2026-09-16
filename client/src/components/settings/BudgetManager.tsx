import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Card, EmptyState, ErrorText, Input, Label, Modal, Select, Spinner } from "../ui";
import type { Budget, Category } from "../../api/types";
import { formatCurrency } from "../../lib/format";
import { MONTH_LABELS } from "../../lib/dateUtils";

export function BudgetManager({ familyId, currency }: { familyId: string; currency: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
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
      const [budgetsRes, categoriesRes] = await Promise.all([
        api.get<Budget[]>(`/families/${familyId}/budgets`, { params: { year, month } }),
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
  }, [familyId, year, month]);

  const expenseCategories = useMemo(() => categories.filter((c) => c.type === "EXPENSE"), [categories]);
  const budgetedCategoryIds = useMemo(() => new Set(budgets.map((b) => b.categoryId)), [budgets]);
  const availableCategories = useMemo(
    () => expenseCategories.filter((c) => !budgetedCategoryIds.has(c.id)),
    [expenseCategories, budgetedCategoryIds]
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Budgets</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="!w-auto">
            {MONTH_LABELS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </Select>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="!w-auto">
            {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <Button variant="secondary" onClick={() => setEditing("new")}>
            <Plus size={16} className="mr-1.5" />
            Add
          </Button>
        </div>
      </div>

      <ErrorText>{error || deleteError}</ErrorText>

      {isLoading ? (
        <Spinner label="Loading budgets..." />
      ) : budgets.length === 0 ? (
        <EmptyState title="No budgets for this month" description="Add a budget to track spending against a category." />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {budgets.map((budget) => {
            const pct = budget.amount > 0 ? Math.min(1, budget.spent / budget.amount) : 0;
            const over = budget.spent > budget.amount;
            return (
              <li key={budget.id} className="py-3">
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: budget.category.color }} />
                    <span className="truncate">{budget.category.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(budget)}
                      aria-label={`Edit ${budget.category.name} budget`}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <Pencil size={14} />
                    </button>
                    {deletingId === budget.id ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => handleDelete(budget.id)}
                          className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeletingId(budget.id)}
                        aria-label={`Delete ${budget.category.name} budget`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600 dark:hover:bg-slate-800 dark:hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </span>
                </div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className={over ? "text-expense" : "text-slate-500"}>
                    {formatCurrency(budget.spent, currency)} / {formatCurrency(budget.amount, currency)}
                  </span>
                  {budget.rollover && <span className="text-slate-400 dark:text-slate-500">Rollover on</span>}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className={`h-full rounded-full ${over ? "bg-expense" : "bg-brand-500"}`}
                    style={{ width: `${pct * 100}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <BudgetFormModal
          familyId={familyId}
          year={year}
          month={month}
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
  budget,
  categories,
  onClose,
  onSaved,
}: {
  familyId: string;
  year: number;
  month: number;
  budget: Budget | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(budget);
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? categories[0]?.id ?? "");
  const [amount, setAmount] = useState(budget ? String(budget.amount) : "");
  const [rollover, setRollover] = useState(budget?.rollover ?? false);
  const [isCommon, setIsCommon] = useState(budget ? budget.ownerId === null : true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && budget) {
        await api.patch(`/families/${familyId}/budgets/${budget.id}`, {
          amount: Number(amount) || 0,
          rollover,
        });
      } else {
        await api.post(`/families/${familyId}/budgets`, {
          categoryId,
          amount: Number(amount) || 0,
          year,
          month,
          period: "MONTHLY",
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
    <Modal title={isEdit ? "Edit budget" : "Add budget"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!isEdit && (
          <div>
            <Label htmlFor="budget-category">Category</Label>
            {categories.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                All expense categories already have a budget for this month.
              </p>
            ) : (
              <Select id="budget-category" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        )}
        <div>
          <Label htmlFor="budget-amount">Monthly amount</Label>
          <Input
            id="budget-amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            id="budget-rollover"
            type="checkbox"
            checked={rollover}
            onChange={(e) => setRollover(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <Label htmlFor="budget-rollover" className="mb-0">
            Roll over unused amount to next month
          </Label>
        </div>
        {!isEdit && (
          <div className="flex items-center gap-2">
            <input
              id="budget-is-common"
              type="checkbox"
              checked={isCommon}
              onChange={(e) => setIsCommon(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="budget-is-common" className="mb-0">
              Shared family (common) budget
            </Label>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || (!isEdit && !categoryId) || !amount}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
