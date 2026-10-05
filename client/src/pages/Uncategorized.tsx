import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Check, Home, Inbox, Sparkles, Wand2 } from "lucide-react";
import type { PayeeRule, Transaction } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { useFamilyData, useRecentHistory } from "../context/FamilyDataContext";
import { getErrorMessage } from "../api/errors";
import type { LayoutContext } from "../components/Layout";
import {
  applyMatches,
  categorizable,
  createPayeeRule,
  describeTarget,
  fetchPayeeRules,
  findRule,
  isUncategorized,
  learnMappings,
  matchCategory,
  normalizePayee,
  seriesKey,
  type PayeeTarget,
} from "../lib/payeeRules";
import { CategoryPicker } from "../components/CategoryPicker";
import { TransactionRow } from "../components/transactions/TransactionRow";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";
import { Button, Card, CardHeader, Chip, EmptyState, ErrorText, SkeletonRows, SuccessText, cn } from "../components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;
// Old enough entries were probably left alone on purpose; the review is about recent ones.
const LOOKBACK_DAYS = 90;
const MAX_SHOWN = 60;

/** Just filed by hand: offered as a rule so the next one from this payee files itself. */
interface Offer {
  payee: string;
  type: "INCOME" | "EXPENSE";
  target: PayeeTarget;
}

export function Uncategorized() {
  const { family } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const { accounts, categories, invalidateAll, invalidateYear } = useFamilyData();
  const isAdmin = family.role === "ADMIN";
  const canEdit = family.role !== "VIEWER";

  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Filed in this visit: hidden straight away rather than waiting for the cache to refetch.
  const [filedIds, setFiledIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);

  useEffect(() => {
    fetchPayeeRules(family.id)
      .then(setRules)
      .catch((err) => setError(getErrorMessage(err, "Unable to load payee rules")));
  }, [family.id]);

  const { data: history, isLoading } = useRecentHistory();
  const learned = useMemo(() => learnMappings(history, categories), [history, categories]);

  // Only entries this member may change: their own, or anyone's for an admin.
  const pending = useMemo(() => {
    const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString();
    return history.filter((t) => t.date >= since && !filedIds.has(t.id) && isUncategorized(t) && (isAdmin || t.userId === user!.id));
  }, [history, filedIds, isAdmin, user]);
  const suggested = useMemo(() => categorizable(pending, rules, learned), [pending, rules, learned]);

  async function file(t: Transaction, target: PayeeTarget, { offerRule = true } = {}) {
    setError(null);
    setNotice(null);
    setBusyId(t.id);
    try {
      await applyMatches(family.id, [{ transaction: t, match: target }]);
      setFiledIds((ids) => new Set(ids).add(t.id));
      invalidateYear(new Date(t.date).getFullYear());
      const type = t.type as "INCOME" | "EXPENSE";
      const pattern = t.payee ? seriesKey(t.payee) || normalizePayee(t.payee) : "";
      const rule = t.payee ? findRule(rules, t.payee, type) : null;
      const covered = rule && rule.categoryId === target.categoryId && rule.familyTransfer === target.familyTransfer;
      setOffer(offerRule && canEdit && pattern.length >= 2 && !covered ? { payee: pattern, type, target } : null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update the transaction"));
    } finally {
      setBusyId(null);
    }
  }

  async function keepOffer() {
    if (!offer) return;
    setError(null);
    try {
      const saved = await createPayeeRule(family.id, { payee: offer.payee, type: offer.type, categoryId: offer.target.categoryId, familyTransfer: offer.target.familyTransfer });
      setRules((list) => [...list, saved]);
      setNotice(`Saved: “${saved.payee}” → ${describeTarget(saved)}. Later ones file themselves.`);
      setOffer(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the rule"));
    }
  }

  async function applyAll() {
    setError(null);
    setNotice(null);
    setOffer(null);
    setApplying(true);
    try {
      const saved = await applyMatches(family.id, suggested);
      setFiledIds((ids) => new Set([...ids, ...suggested.map((s) => s.transaction.id)]));
      invalidateAll();
      setNotice(`Filed ${saved} transaction${saved === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update transactions"));
    } finally {
      setApplying(false);
    }
  }

  const shown = pending.slice(0, MAX_SHOWN);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <CardHeader
          title={isLoading ? "Uncategorised" : pending.length === 0 ? "All sorted" : `${pending.length} to sort out`}
          subtitle={`Expenses and income from the last ${LOOKBACK_DAYS} days with no category.`}
          icon={<Inbox size={17} />}
          className={canEdit && suggested.length > 0 ? undefined : "!mb-0"}
          actions={
            <Link to="/payee-rules">
              <Button size="sm" variant="secondary" icon={<Wand2 size={14} />}>
                Rules
              </Button>
            </Link>
          }
        />
        {canEdit && suggested.length > 0 && (
          <Button variant="secondary" loading={applying} icon={<Sparkles size={15} />} onClick={applyAll}>
            File {suggested.length} with suggestions
          </Button>
        )}
        {!canEdit && <p className="mt-3 text-sm text-ink-muted">Viewers can't change transactions.</p>}
      </Card>

      <SuccessText>{notice}</SuccessText>
      <ErrorText>{error}</ErrorText>

      {offer && (
        <Card className="space-y-3">
          <p className="text-sm font-medium text-ink">
            Always file “{offer.payee}” {offer.type === "INCOME" ? "income" : "expenses"} as {describeTarget(offer.target)}?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={keepOffer}>
              Remember
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOffer(null)}>
              Not now
            </Button>
          </div>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : pending.length === 0 ? (
        <EmptyState title="Nothing to sort out" description="Every recent expense and income has a category." icon={<Check size={22} />} />
      ) : (
        <div className="space-y-3">
          {shown.map((t) => {
            const match = matchCategory(t.payee, t.type, rules, learned);
            const matchCategoryLive = match?.categoryId ? categories.some((c) => c.id === match.categoryId) : true;
            return (
              <Card key={t.id} className={cn("!py-3 transition-opacity", busyId === t.id && "pointer-events-none opacity-50")}>
                <TransactionRow transaction={t} onClick={() => setEditing(t)} />
                {canEdit && (
                  <div className="mt-2 space-y-2.5">
                    <div className="flex flex-wrap gap-2">
                      {match && matchCategoryLive && (
                        <Chip onClick={() => file(t, match, { offerRule: match.source !== "rule" })}>
                          <Sparkles size={13} className="text-brand-600" />
                          {match.category && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: match.category.color }} />}
                          {describeTarget(match)}
                        </Chip>
                      )}
                      <Chip onClick={() => file(t, { categoryId: null, category: null, familyTransfer: true })}>
                        <Home size={13} className="text-brand-600" />
                        {t.type === "INCOME" ? "From family" : "To family"}
                      </Chip>
                    </div>
                    <CategoryPicker
                      categories={categories.filter((c) => c.type === t.type)}
                      selectedId={null}
                      placeholder="Pick a category"
                      onSelect={(id) => {
                        const category = categories.find((c) => c.id === id);
                        if (category) file(t, { categoryId: category.id, category, familyTransfer: false });
                      }}
                    />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {pending.length > MAX_SHOWN && (
        <p className="text-center text-xs text-ink-subtle">Showing the newest {MAX_SHOWN}. File these and the rest will appear.</p>
      )}

      {editing && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          transaction={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => invalidateYear(new Date(saved.date).getFullYear())}
        />
      )}
    </div>
  );
}
