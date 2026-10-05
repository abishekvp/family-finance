import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ChevronRight, Home, Inbox, Plus, Sparkles, Wand2 } from "lucide-react";
import type { PayeeRule } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useFamilyData, useRecentHistory } from "../context/FamilyDataContext";
import { getErrorMessage } from "../api/errors";
import type { LayoutContext } from "../components/Layout";
import {
  applyMatches,
  categorizable,
  createPayeeRule,
  deletePayeeRule,
  describeTarget,
  fetchPayeeRules,
  findRule,
  isSealed,
  learnMappings,
  ruleMatches,
  updatePayeeRule,
  type LearnedMapping,
  type PayeeRuleInput,
} from "../lib/payeeRules";
import { CategoryPicker } from "../components/CategoryPicker";
import { Badge, Button, Card, CardHeader, Dot, EmptyState, ErrorText, Field, Input, Segmented, SkeletonRows, SuccessText, Toggle } from "../components/ui";

// Suggestions need a pattern to be worth keeping: a payee seen once isn't one yet.
const MIN_SUGGESTION_COUNT = 2;
const MAX_SUGGESTIONS = 40;

type RuleType = PayeeRule["type"];

/** What the editor holds: a saved rule being changed, or a new one (maybe from a suggestion). */
interface Draft extends PayeeRuleInput {
  id: string | null;
}

export function PayeeRules() {
  const { family } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const { categories, invalidateAll } = useFamilyData();
  const canEdit = family.role !== "VIEWER";
  const isAdmin = family.role === "ADMIN";
  const topRef = useRef<HTMLDivElement>(null);

  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPayeeRules(family.id)
      .then((list) => !cancelled && setRules(list))
      .catch((err) => !cancelled && setError(getErrorMessage(err, "Unable to load payee rules")))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [family.id]);

  // A year of the family's history is what the suggestions are read from.
  const { data: history } = useRecentHistory();
  const learned = useMemo(() => learnMappings(history, categories), [history, categories]);

  const sealedRules = rules.some((r) => isSealed(r.payee));
  const sortedRules = useMemo(() => [...rules].sort((a, b) => a.payee.localeCompare(b.payee)), [rules]);

  // History the saved rules don't already cover.
  const suggestions = useMemo(() => {
    const out: LearnedMapping[] = [];
    for (const m of learned.values()) {
      if (m.count < MIN_SUGGESTION_COUNT || findRule(rules, m.payee, m.type)) continue;
      out.push(m);
    }
    return out.sort((a, b) => b.count - a.count).slice(0, MAX_SUGGESTIONS);
  }, [learned, rules]);

  // Unfiled entries the rules (and history) can fill in, among those this member may change.
  const fillable = useMemo(
    () => categorizable(history.filter((t) => isAdmin || t.userId === user!.id), rules, learned),
    [history, rules, learned, isAdmin, user]
  );

  function edit(next: Draft) {
    setNotice(null);
    setError(null);
    setDraft(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function quickSave(m: LearnedMapping) {
    setError(null);
    setNotice(null);
    try {
      const saved = await createPayeeRule(family.id, { payee: m.payee, type: m.type, categoryId: m.categoryId, familyTransfer: m.familyTransfer });
      setRules((list) => [...list, saved]);
      setNotice(`Saved: “${m.payee}” → ${describeTarget(m)}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the rule"));
    }
  }

  async function applyAll() {
    setError(null);
    setNotice(null);
    setApplying(true);
    try {
      const saved = await applyMatches(family.id, fillable);
      invalidateAll();
      setNotice(`Filed ${saved} transaction${saved === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update transactions"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div ref={topRef} className="mx-auto max-w-3xl scroll-mt-24 space-y-5">
      {draft ? (
        <RuleEditor
          familyId={family.id}
          draft={draft}
          history={history}
          onCancel={() => setDraft(null)}
          onSaved={(saved, wasNew) => {
            setRules((list) => [...list.filter((r) => r.id !== saved.id), saved]);
            setDraft(null);
            setNotice(wasNew ? `Saved: “${saved.payee}” → ${describeTarget(saved)}.` : "Rule updated.");
          }}
          onDeleted={(id) => {
            setRules((list) => list.filter((r) => r.id !== id));
            setDraft(null);
            setNotice("Rule deleted.");
          }}
        />
      ) : (
        <Card>
          <CardHeader
            title="Payee rules"
            subtitle="File transactions automatically by who they're to or from — typed in, or recorded from SMS."
            icon={<Wand2 size={17} />}
            actions={
              canEdit ? (
                <Button size="sm" icon={<Plus size={14} />} onClick={() => edit({ id: null, payee: "", type: "EXPENSE", categoryId: null, familyTransfer: false })}>
                  Add rule
                </Button>
              ) : undefined
            }
          />
          <p className="text-sm leading-relaxed text-ink-muted">
            A rule matches any payee containing its text at the start of a word, ignoring case: “swiggy” matches SWIGGY*4521 and swiggy@ybl.
            When several match, the longest wins. Mark money from parents or sent home as a family transfer so it isn't counted as income or
            spending.
          </p>
        </Card>
      )}

      <SuccessText>{notice}</SuccessText>
      <ErrorText>{error}</ErrorText>

      <Link to="/uncategorized" className="block">
        <Card interactive className="flex items-center gap-3 !py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-600">
            <Inbox size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Review uncategorised</p>
            <p className="text-xs text-ink-subtle">Sort out entries that have no category yet</p>
          </div>
          <ChevronRight size={17} className="text-ink-subtle" />
        </Card>
      </Link>

      {canEdit && fillable.length > 0 && (
        <Card>
          <CardHeader
            title={`${fillable.length} unfiled transaction${fillable.length === 1 ? "" : "s"} can be filed`}
            subtitle="Your rules and history know where these go."
            icon={<Sparkles size={17} />}
            className="!mb-3"
            actions={
              <Button variant="secondary" size="sm" loading={applying} onClick={applyAll}>
                File them now
              </Button>
            }
          />
        </Card>
      )}

      <Card>
        <CardHeader title="Your rules" subtitle="Shared with your family." />
        {sealedRules && <p className="mb-3 text-xs text-ink-subtle">Unlock your vault to read encrypted rules.</p>}
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : sortedRules.length === 0 ? (
          <EmptyState title="No rules yet" description="Add one, or keep a suggestion below." />
        ) : (
          <ul className="divide-y divide-line">
            {sortedRules.map((rule) => {
              const editable = canEdit && !isSealed(rule.payee);
              return (
                <li key={rule.id}>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => edit({ id: rule.id, payee: rule.payee, type: rule.type, categoryId: rule.categoryId, familyTransfer: rule.familyTransfer })}
                    className="-mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition enabled:hover:bg-surface-sunken disabled:cursor-default"
                  >
                    <TargetIcon category={rule.category} familyTransfer={rule.familyTransfer} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{rule.payee}</span>
                      <span className="block truncate text-xs text-ink-subtle">
                        {rule.type === "INCOME" ? "Income" : "Expense"} → {describeTarget(rule)}
                      </span>
                    </span>
                    {editable && <ChevronRight size={16} className="text-ink-subtle" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Suggested from your history"
          subtitle="How each payee was filed most often. Keep one as a rule, or click to change it first."
          icon={<Sparkles size={17} />}
        />
        {suggestions.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {history.length === 0 ? "Nothing to learn from yet." : "No new suggestions — your rules cover the payees you file regularly."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {suggestions.map((m) => (
              <li key={`${m.type}|${m.payee}`} className="flex items-center gap-3 py-2">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => edit({ id: null, payee: m.payee, type: m.type, categoryId: m.categoryId, familyTransfer: m.familyTransfer })}
                  className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition enabled:hover:bg-surface-sunken disabled:cursor-default"
                >
                  <TargetIcon category={m.category} familyTransfer={m.familyTransfer} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{m.payee}</span>
                    <span className="block truncate text-xs text-ink-subtle">
                      {m.type === "INCOME" ? "Income" : "Expense"} → {describeTarget(m)} · {m.count} of {m.total}
                    </span>
                  </span>
                </button>
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => quickSave(m)}>
                    Keep
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TargetIcon({ category, familyTransfer }: { category: { color: string } | null; familyTransfer: boolean }) {
  if (familyTransfer && !category) {
    return (
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-600">
        <Home size={14} />
      </span>
    );
  }
  return (
    <span className="grid w-8 shrink-0 place-items-center">
      <Dot color={category?.color ?? "#94A3B8"} size={11} />
    </span>
  );
}

function RuleEditor({
  familyId,
  draft,
  history,
  onCancel,
  onSaved,
  onDeleted,
}: {
  familyId: string;
  draft: Draft;
  history: { payee: string | null; type: string }[];
  onCancel: () => void;
  onSaved: (rule: PayeeRule, wasNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const { categories } = useFamilyData();
  const [payee, setPayee] = useState(draft.payee);
  const [type, setType] = useState<RuleType>(draft.type);
  const [categoryId, setCategoryId] = useState<string | null>(draft.categoryId);
  const [familyTransfer, setFamilyTransfer] = useState(draft.familyTransfer);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesForType = useMemo(() => categories.filter((c) => c.type === type), [categories, type]);
  const matches = useMemo(
    () => (payee.trim() ? history.filter((t) => t.type === type && t.payee && !isSealed(t.payee) && ruleMatches(payee, t.payee)).length : 0),
    [history, payee, type]
  );
  const canSave = payee.trim().length >= 2 && (!!categoryId || familyTransfer);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const input = { payee: payee.trim(), type, categoryId, familyTransfer };
      const saved = draft.id ? await updatePayeeRule(familyId, draft.id, input) : await createPayeeRule(familyId, input);
      onSaved(saved, !draft.id);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the rule"));
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setError(null);
    setSaving(true);
    try {
      await deletePayeeRule(familyId, draft.id);
      onDeleted(draft.id);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete the rule"));
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={draft.id ? "Edit rule" : "New rule"} icon={<Wand2 size={17} />} />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave && !saving) save();
        }}
      >
        <Segmented
          value={type}
          onChange={(next) => {
            setType(next);
            if (categories.find((c) => c.id === categoryId)?.type !== next) setCategoryId(null);
          }}
          options={[
            { value: "EXPENSE", label: "Expense" },
            { value: "INCOME", label: "Income" },
          ]}
          className="w-full [&>button]:flex-1"
        />
        <Field
          label="Payee contains"
          hint={payee.trim() ? `Matches ${matches} of your entries from the past year.` : "e.g. swiggy, amazon, or a family member's name as it appears in alerts."}
        >
          {(props) => <Input {...props} autoFocus value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Payee text" autoCapitalize="none" autoCorrect="off" />}
        </Field>
        <Field label="Category" hint={familyTransfer ? "Optional for a family transfer." : undefined}>
          {(props) => <CategoryPicker {...props} categories={categoriesForType} selectedId={categoryId} onSelect={setCategoryId} clearLabel="No category" />}
        </Field>
        <Toggle
          checked={familyTransfer}
          onChange={setFamilyTransfer}
          label="Family transfer"
          description={
            type === "INCOME"
              ? "Money from family: it goes into the account but isn't income, and isn't owed back."
              : "Money to family: it leaves the account but isn't spending or in budgets, and isn't owed back."
          }
        />
        {familyTransfer && <Badge tone="brand">Not counted in income or spending</Badge>}
        <ErrorText>{error}</ErrorText>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={saving} disabled={!canSave}>
            Save rule
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          {draft.id && !confirmDelete && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setConfirmDelete(true)} className="ml-auto text-expense hover:text-expense">
              Delete rule
            </Button>
          )}
        </div>
        {draft.id && confirmDelete && (
          <div className="space-y-3 rounded-2xl bg-expense-soft p-4">
            <p className="text-sm font-medium text-ink">Delete this rule? Transactions already filed by it stay as they are.</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="danger" loading={saving} onClick={remove}>
                Delete
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          </div>
        )}
      </form>
    </Card>
  );
}
