import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { Budget, RecurringFrequency, RecurringTransaction } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { Button, Card, Chip, ErrorText, Field, Input, Label, Segmented, SkeletonRows, Toggle, cn } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import { useFamilyData } from "../context/FamilyDataContext";
import { CategoryPicker } from "../components/CategoryPicker";
import { NewCategoryForm } from "../components/NewCategoryForm";
import { currencySymbol } from "../lib/format";
import { localDateInput } from "../lib/dateUtils";
import { isPerson } from "../lib/lending";
import { FREQUENCIES, describeSchedule, runRecurring } from "../lib/recurring";
import { budgetName } from "../lib/budgets";

type RuleType = "EXPENSE" | "INCOME";

function isDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(new Date(`${value.trim()}T00:00:00`).getTime());
}

/** Adds (/recurring/new) or edits (/recurring/:id) a repeating payment. */
export function RecurringForm() {
  const { id } = useParams<{ id: string }>();
  const { family } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();
  const { accounts: allAccounts, categories: baseCategories, refreshCategories, invalidateAll, refreshAccounts } = useFamilyData();
  const canEdit = family.role !== "VIEWER";
  const isNew = id === "new";

  const [initial, setInitial] = useState<RecurringTransaction | null>(null);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  // This month's and this year's budgets, to pick the one a payment counts in.
  const [budgets, setBudgets] = useState<Budget[]>([]);

  const [type, setType] = useState<RuleType>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [frequency, setFrequency] = useState<RecurringFrequency>("MONTHLY");
  // For a new payment, its first day; for an existing one, its next day.
  const [day, setDay] = useState(localDateInput(new Date()));
  const [endDate, setEndDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [addingCategory, setAddingCategory] = useState(false);
  const [created, setCreated] = useState<typeof baseCategories>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const accounts = allAccounts.filter((a) => !isPerson(a));
  const categories = [...baseCategories, ...created.filter((c) => !baseCategories.some((b) => b.id === c.id))];

  useEffect(() => {
    if (isNew) return;
    let cancelled = false;
    api
      .get<RecurringTransaction[]>(`/families/${family.id}/recurring`)
      .then((res) => {
        if (cancelled) return;
        const rule = res.data.find((r) => r.id === id) ?? null;
        if (!rule) {
          setLoadError("This repeating payment was deleted.");
          return;
        }
        setInitial(rule);
        setType(rule.type);
        setAmount(String(rule.amount));
        setPayee(rule.payee ?? "");
        setFrequency(rule.frequency);
        setDay(rule.nextDate);
        setEndDate(rule.endDate ?? "");
        setAccountId(rule.accountId);
        setCategoryId(rule.categoryId);
        setNotes(rule.notes ?? "");
        setIsActive(rule.isActive);
      })
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err, "Unable to load the repeating payment")))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [family.id, id, isNew]);

  useEffect(() => {
    const now = new Date();
    const url = `/families/${family.id}/budgets`;
    const tzOffset = now.getTimezoneOffset();
    Promise.all([
      api.get<Budget[]>(url, { params: { year: now.getFullYear(), month: now.getMonth() + 1, tzOffset } }).catch(() => ({ data: [] as Budget[] })),
      api.get<Budget[]>(url, { params: { year: now.getFullYear(), period: "ANNUAL", tzOffset } }).catch(() => ({ data: [] as Budget[] })),
    ]).then(([monthRes, yearRes]) => setBudgets([...monthRes.data, ...yearRes.data]));
  }, [family.id]);

  useEffect(() => {
    if (!accountId && accounts.length > 0 && (isNew || !isLoading)) setAccountId(accounts[0].id);
  }, [accounts, accountId, isNew, isLoading]);

  const isEdit = !!initial;
  const categoriesForType = categories.filter((c) => c.type === type);
  // Yearly payments count in yearly budgets; weekly and monthly ones in monthly budgets.
  const periodBudgets = type === "EXPENSE" ? budgets.filter((b) => (frequency === "YEARLY") === (b.period === "ANNUAL")) : [];
  const selectedCategory = categories.find((c) => c.id === categoryId);
  // Its budget: the one on its category, else on its parent category.
  const countsIn =
    periodBudgets.find((b) => b.categoryId === categoryId) ??
    periodBudgets.find((b) => !!selectedCategory?.parentId && b.categoryId === selectedCategory.parentId) ??
    null;
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const symbol = currencySymbol(selectedAccount?.currency ?? family.currency);
  const amountValue = Number(amount);
  const canSubmit = canEdit && !!accountId && amount.trim().length > 0 && amountValue > 0 && day.trim().length > 0;

  function handleSelectType(next: RuleType) {
    setType(next);
    const current = categories.find((c) => c.id === categoryId);
    if (current && current.type !== next) setCategoryId(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isDay(day)) return setError("Pick the payment date");
    if (endDate.trim() && !isDay(endDate)) return setError("Pick a valid end date");
    if (endDate.trim() && endDate.trim() < day.trim()) return setError("The end date is before the payment date");

    setIsSaving(true);
    try {
      const common = {
        type,
        amount: amountValue,
        accountId,
        categoryId,
        payee: payee.trim() || null,
        notes: notes.trim() || null,
        endDate: endDate.trim() || null,
      };
      if (isEdit && initial) {
        await api.patch(`/families/${family.id}/recurring/${initial.id}`, {
          ...common,
          isActive,
          // Only a changed schedule restarts it from the next payment.
          ...(frequency !== initial.frequency ? { frequency } : {}),
          ...(day.trim() !== initial.nextDate || frequency !== initial.frequency ? { nextDate: day.trim() } : {}),
        });
      } else {
        await api.post(`/families/${family.id}/recurring`, { ...common, frequency, startDate: day.trim() });
      }
      // A payment due today (or earlier) is recorded straight away.
      if ((await runRecurring(family.id)) > 0) {
        invalidateAll();
        refreshAccounts().catch(() => undefined);
      }
      navigate("/recurring");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save"));
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    setIsDeleting(true);
    try {
      await api.delete(`/families/${family.id}/recurring/${initial.id}`);
      navigate("/recurring");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete"));
      setConfirmDelete(false);
      setIsDeleting(false);
    }
  }

  const budgetHint =
    type !== "EXPENSE"
      ? "Recorded as income on each date."
      : frequency === "YEARLY"
        ? "Recorded on each date and counted in your yearly budget for its category."
        : "Recorded on each date and counted in your monthly budget for its category.";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link to="/recurring" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
        <ArrowLeft size={15} />
        Repeating payments
      </Link>

      <Card>
        <h2 className="mb-5 text-lg font-bold text-ink">{isNew ? "New repeating payment" : "Edit repeating payment"}</h2>
        {isLoading ? (
          <SkeletonRows rows={5} />
        ) : loadError ? (
          <ErrorText>{loadError}</ErrorText>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <Segmented
              value={type}
              onChange={handleSelectType}
              options={[
                { value: "EXPENSE", label: "Expense" },
                { value: "INCOME", label: "Income" },
              ]}
              className="w-full [&>button]:flex-1"
            />

            <div className="rounded-2xl border border-line bg-surface-sunken/60 px-4 py-5 text-center">
              <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">Amount each time</p>
              <div className={cn("flex items-center justify-center gap-1.5 text-4xl font-extrabold tracking-tight", type === "EXPENSE" ? "text-expense" : "text-income")}>
                <span className="text-2xl opacity-70">{symbol}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  required
                  autoFocus={isNew}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  aria-label="Amount each time"
                  className="w-40 bg-transparent text-center tabular-nums outline-none placeholder:text-ink-subtle/50"
                />
              </div>
            </div>

            <Field label="Name">
              {(props) => (
                <Input {...props} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder={type === "EXPENSE" ? "e.g. Maid salary, Netflix, Rent" : "e.g. Salary"} />
              )}
            </Field>

            <div>
              <Label>Repeats</Label>
              <div className="flex flex-wrap gap-2">
                {FREQUENCIES.map((f) => (
                  <Chip key={f.value} selected={frequency === f.value} onClick={() => setFrequency(f.value)}>
                    {f.label}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-subtle">{isDay(day) ? `${describeSchedule({ frequency, startDate: day.trim() })}. ${budgetHint}` : budgetHint}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={isEdit ? "Next payment" : "First payment"}>
                {(props) => <Input {...props} type="date" required value={day} onChange={(e) => setDay(e.target.value)} />}
              </Field>
              <Field label="Ends on" hint="Optional">
                {(props) => <Input {...props} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
              </Field>
            </div>

            <div>
              <Label>{type === "EXPENSE" ? "Paid from" : "Paid into"}</Label>
              {accounts.length === 0 ? (
                <p className="text-sm text-ink-subtle">Add an account first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {accounts.map((a) => (
                    <Chip key={a.id} selected={accountId === a.id} onClick={() => setAccountId(a.id)}>
                      {a.name}
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            {periodBudgets.length > 0 && (
              <div>
                <Label>Counts in budget</Label>
                <div className="flex flex-wrap gap-2">
                  {periodBudgets.map((b) => (
                    <Chip key={b.id} color={b.category.color} selected={countsIn?.id === b.id} onClick={() => setCategoryId(b.categoryId)}>
                      {`${budgetName(b)}${b.ownerId ? "" : " · Family"}`}
                    </Chip>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-ink-subtle">
                  {countsIn
                    ? `Counted in your ${frequency === "YEARLY" ? "yearly" : "monthly"} ${budgetName(countsIn)} budget.`
                    : "Pick a budget, or a category below. Choosing a budget puts it in that budget's category."}
                </p>
              </div>
            )}

            <Field label="Category" hint={type === "EXPENSE" ? "Its budget is where this counts." : undefined}>
              {(props) => (
                <>
                  <CategoryPicker
                    {...props}
                    categories={categoriesForType}
                    selectedId={categoryId}
                    onSelect={setCategoryId}
                    clearLabel="No category"
                    onAddNew={canEdit && !addingCategory ? () => setAddingCategory(true) : undefined}
                  />
                  {addingCategory && (
                    <NewCategoryForm
                      familyId={family.id}
                      type={type}
                      taken={categories}
                      onCreated={(c) => {
                        setCreated((list) => [...list, c]);
                        setCategoryId(c.id);
                        setAddingCategory(false);
                        refreshCategories().catch(() => undefined);
                      }}
                      onCancel={() => setAddingCategory(false)}
                    />
                  )}
                </>
              )}
            </Field>

            <Field label="Notes" hint="Optional">
              {(props) => <Input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />}
            </Field>

            {isEdit && <Toggle checked={isActive} onChange={setIsActive} label="Active" description="Off pauses it; nothing new is recorded." />}

            <ErrorText>{error}</ErrorText>

            <div className="flex flex-wrap gap-2 pt-1">
              {canEdit && (
                <Button type="submit" loading={isSaving} disabled={!canSubmit}>
                  {isEdit ? "Save changes" : "Save"}
                </Button>
              )}
              <Button type="button" variant="secondary" onClick={() => navigate("/recurring")}>
                Cancel
              </Button>
              {isEdit && canEdit && !confirmDelete && (
                <Button type="button" variant="ghost" icon={<Trash2 size={15} />} className="ml-auto text-expense hover:text-expense" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
            </div>

            {isEdit && canEdit && confirmDelete && (
              <div className="space-y-3 rounded-2xl bg-expense-soft p-4">
                <p className="text-sm font-medium text-ink">Delete this repeating payment? Payments already recorded stay in your transactions.</p>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="danger" loading={isDeleting} onClick={handleDelete}>
                    Delete
                  </Button>
                  <Button type="button" size="sm" variant="secondary" disabled={isDeleting} onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}
