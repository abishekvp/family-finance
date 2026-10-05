import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, PiggyBank, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  Modal,
  ProgressBar,
  SkeletonRows,
  Toggle,
} from "../ui";
import { Money } from "../figures";
import type { Goal } from "../../api/types";
import { readCache, writeCache } from "../../lib/sessionCache";

export function GoalManager({ familyId, currency }: { familyId: string; currency: string }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [contributingTo, setContributingTo] = useState<Goal | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function load() {
    const key = `/families/${familyId}/goals`;
    const cached = readCache<Goal[]>(key);
    if (cached) setGoals(cached.data);
    setIsLoading(!cached);
    setError(null);
    try {
      const res = await api.get<Goal[]>(key);
      setGoals(res.data);
      writeCache(key, res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load goals"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  async function handleDelete(goalId: string) {
    setDeleteError(null);
    try {
      await api.delete(`/families/${familyId}/goals/${goalId}`);
      setDeletingId(null);
      await load();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Unable to delete goal"));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Savings goals"
        subtitle={goals.length > 0 ? `${goals.filter((g) => !g.isCompleted).length} in progress` : undefined}
        icon={<PiggyBank size={17} />}
        actions={
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
            Add
          </Button>
        }
      />

      <ErrorText>{error || deleteError}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No savings goals yet"
          description="Set a target — a vacation, an emergency fund — and track progress as you contribute."
          icon={<PiggyBank size={18} />}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {goals.map((goal) => (
            <li key={goal.id} className="rounded-2xl border border-line bg-surface-sunken/40 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  {goal.isCompleted && <CheckCircle2 size={15} className="shrink-0 text-income" />}
                  <span className="truncate">{goal.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {!goal.isCompleted && (
                    <Button size="sm" variant="secondary" onClick={() => setContributingTo(goal)}>
                      Add money
                    </Button>
                  )}
                  {deletingId === goal.id ? (
                    <span className="flex items-center gap-1.5">
                      <Button size="sm" variant="danger" onClick={() => handleDelete(goal.id)}>
                        Confirm
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeletingId(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <IconButton label={`Delete ${goal.name} goal`} tone="danger" onClick={() => setDeletingId(goal.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </span>
              </div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="tnum text-ink-subtle">
                  <Money amount={goal.saved} currency={currency} /> of <Money amount={goal.targetAmount} currency={currency} />
                </span>
                <span className="text-ink-subtle">{Math.round(goal.progress * 100)}%</span>
              </div>
              <ProgressBar value={goal.progress} tone={goal.isCompleted ? "income" : "brand"} />
              {goal.targetDate && (
                <p className="mt-1.5 text-2xs text-ink-subtle">
                  Target date {new Date(goal.targetDate).toLocaleDateString()}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <GoalFormModal familyId={familyId} onClose={() => setEditing(null)} onSaved={load} />
      )}

      {contributingTo && (
        <ContributeModal
          familyId={familyId}
          goal={contributingTo}
          currency={currency}
          onClose={() => setContributingTo(null)}
          onSaved={load}
        />
      )}
    </Card>
  );
}

function GoalFormModal({
  familyId,
  onClose,
  onSaved,
}: {
  familyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [isCommon, setIsCommon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/goals`, {
        name,
        targetAmount: Number(targetAmount) || 0,
        targetDate: targetDate || undefined,
        isCommon,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save goal"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title="Add savings goal"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="goal-form" loading={isSubmitting} disabled={!name || !targetAmount}>
            Save
          </Button>
        </div>
      }
    >
      <form id="goal-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Goal name">
          {(props) => (
            <Input {...props} required placeholder="Emergency fund" value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label="Target amount">
          {(props) => (
            <Input
              {...props}
              type="number"
              step="0.01"
              min="0.01"
              required
              value={targetAmount}
              onChange={(e) => setTargetAmount(e.target.value)}
            />
          )}
        </Field>
        <Field label="Target date" hint="Optional">
          {(props) => (
            <Input {...props} type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          )}
        </Field>
        <Toggle
          checked={isCommon}
          onChange={setIsCommon}
          label="Shared family goal"
          description="Any family member can contribute."
        />
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

function ContributeModal({
  familyId,
  goal,
  currency,
  onClose,
  onSaved,
}: {
  familyId: string;
  goal: Goal;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/goals/${goal.id}/contributions`, {
        amount: Number(amount) || 0,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to add contribution"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Modal
      title={`Add money to "${goal.name}"`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="contribute-form" loading={isSubmitting} disabled={!amount}>
            Add
          </Button>
        </div>
      }
    >
      <form id="contribute-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
          <Sparkles size={13} />
          <Money amount={goal.saved} currency={currency} /> saved of <Money amount={goal.targetAmount} currency={currency} /> target
        </p>
        <Field label="Amount">
          {(props) => (
            <Input
              {...props}
              type="number"
              step="0.01"
              min="0.01"
              required
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}
