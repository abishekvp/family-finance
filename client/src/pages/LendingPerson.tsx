import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Ban, CheckCircle2, Pencil, Plus, ShoppingBag, Trash2, Undo2, Users } from "lucide-react";
import { api } from "../api/client";
import type { Account, Category, Transaction } from "../api/types";
import { ClientError, getErrorMessage } from "../api/errors";
import { encryptOutgoing, hasFamilyKey } from "../api/vaultSession";
import { Avatar, Badge, Button, Card, Chip, ErrorText, Field, Input, Modal, ProgressBar, SkeletonRows, Toggle, cn, useToast } from "../components/ui";
import { CategoryPicker } from "../components/CategoryPicker";
import type { LayoutContext } from "../components/Layout";
import { useAuth } from "../context/AuthContext";
import { useFamilyData } from "../context/FamilyDataContext";
import { combineDateTime, localDateInput, localTimeInput } from "../lib/dateUtils";
import { formatCurrency } from "../lib/format";
import {
  describeBalance,
  describeEntry,
  isPerson,
  isSettled,
  isWriteOff,
  loanStatus,
  trackLoans,
  withNameInNotes,
  writeOffPayload,
  type LendingKind,
  type Loan,
} from "../lib/lending";
import { LOCKED_PLACEHOLDER } from "../lib/vaultCrypto";
import { TransactionFormModal, type TransactionPreset } from "../components/transactions/TransactionFormModal";

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type FormState = { preset?: TransactionPreset; transaction?: Transaction };

export function LendingPerson() {
  const { id } = useParams<{ id: string }>();
  const { family } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const { accounts, categories, isLoadingStatic, refreshAccounts, invalidateAll, invalidateYear } = useFamilyData();
  const canRecord = family.role !== "VIEWER";
  const navigate = useNavigate();
  const toast = useToast();

  const person = accounts.find((a) => a.id === id) ?? null;
  const [history, setHistory] = useState<Transaction[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [writingOff, setWritingOff] = useState<Loan | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { accountId: id, limit: 5000 } });
      setHistory(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load"));
    } finally {
      setHistoryLoaded(true);
    }
  }, [family.id, id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const loans = useMemo(() => (person ? trackLoans(history, person) : []), [history, person]);
  const openLoans = loans.filter((l) => !l.settled);
  const closedLoans = loans.filter((l) => l.settled);
  // A shared person is the family's: only an admin manages them. A personal one, only its owner.
  const canManage = !!person && canRecord && (person.ownerId === null ? family.role === "ADMIN" : person.ownerId === user!.id);

  function record(kind: LendingKind, amount?: number, repaysId?: string) {
    setForm({ preset: { type: "LENDING", kind, personId: id, ...(amount ? { amount } : {}), ...(repaysId ? { repaysId } : {}) } });
  }

  function openTransaction(t: Transaction) {
    setForm({ transaction: t });
  }

  /** After money was written off, merged or deleted: everything showing balances catches up. */
  async function afterChange() {
    invalidateAll();
    await refreshAccounts().catch(() => undefined);
  }

  if (isLoadingStatic || !historyLoaded) {
    return (
      <Card>
        <SkeletonRows rows={5} />
      </Card>
    );
  }

  if (!person) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorText>{error ?? "This person was removed."}</ErrorText>
      </div>
    );
  }

  const balance = person.balance ?? 0;
  const settled = isSettled(balance);
  const theyOwe = balance > 0;
  const overdue = openLoans.filter((l) => l.overdue).reduce((sum, l) => sum + l.remaining, 0);

  return (
    <div className="space-y-5">
      <BackLink />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-5">
          <Card className="flex flex-col items-center gap-2.5 text-center">
            <Avatar name={person.name} size={52} />
            <h2 className={cn("text-xl font-extrabold", settled ? "text-ink-muted" : theyOwe ? "text-income" : "text-expense")}>
              {describeBalance(person.name, balance, person.currency)}
            </h2>
            {overdue > 0 && <Badge tone="expense">{`${formatCurrency(overdue, person.currency)} overdue`}</Badge>}
            {!person.owner && <p className="text-xs text-ink-subtle">Shared with your family</p>}
          </Card>

          <ErrorText>{error}</ErrorText>

          {canRecord && (
            <div className="space-y-2">
              {settled ? (
                <ButtonPair primary={{ title: "Lend", icon: "out", onClick: () => record("lent") }} secondary={{ title: "Borrow", icon: "in", onClick: () => record("borrowed") }} />
              ) : theyOwe ? (
                <ButtonPair
                  primary={{ title: "Got paid back", icon: "in", onClick: () => record("got-back", balance) }}
                  secondary={{ title: "Lend more", icon: "out", onClick: () => record("lent") }}
                />
              ) : (
                <ButtonPair
                  primary={{ title: "Pay back", icon: "out", onClick: () => record("paid-back", -balance) }}
                  secondary={{ title: "Borrow more", icon: "in", onClick: () => record("borrowed") }}
                />
              )}
              <Button variant="ghost" className="w-full" icon={<ShoppingBag size={16} />} onClick={() => setForm({ preset: { type: "EXPENSE", accountId: person.id } })}>
                {person.name} paid for something
              </Button>
            </div>
          )}

          {openLoans.length > 0 && (
            <Section title="Waiting to be returned">
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {openLoans.map((loan, i) => (
                    <LoanRow
                      key={i}
                      loan={loan}
                      currency={person.currency}
                      onOpen={loan.transaction ? () => openTransaction(loan.transaction!) : undefined}
                      onOpenRepayment={openTransaction}
                      onRecordReturn={
                        canRecord ? () => record(loan.direction === "lent" ? "got-back" : "paid-back", loan.remaining, loan.transaction?.id) : undefined
                      }
                      onWriteOff={canRecord ? () => setWritingOff(loan) : undefined}
                    />
                  ))}
                </ul>
              </Card>
            </Section>
          )}

          {closedLoans.length > 0 && (
            <Section title="Closed">
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {closedLoans.map((loan, i) => (
                    <LoanRow
                      key={i}
                      loan={loan}
                      currency={person.currency}
                      onOpen={loan.transaction ? () => openTransaction(loan.transaction!) : undefined}
                      onOpenRepayment={openTransaction}
                    />
                  ))}
                </ul>
              </Card>
            </Section>
          )}
        </div>
        <div className="space-y-5">
          <Section title="History">
            {history.length === 0 ? (
              <p className="px-0.5 text-sm text-ink-subtle">Nothing recorded yet.</p>
            ) : (
              <Card padded={false}>
                <ul className="divide-y divide-line">
                  {history.map((t) => (
                    <HistoryRow
                      key={t.id}
                      transaction={t}
                      personId={person.id}
                      repays={t.repaysId ? history.find((h) => h.id === t.repaysId) ?? null : null}
                      onClick={() => openTransaction(t)}
                    />
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          {canManage && (
            <div className="space-y-2 pt-2">
              <Button variant="secondary" className="w-full" icon={<Pencil size={15} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="ghost" className="w-full text-expense hover:text-expense" icon={<Trash2 size={15} />} onClick={() => setDeleting(true)}>
                Delete person
              </Button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditPersonModal
          familyId={family.id}
          person={person}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refreshAccounts();
          }}
        />
      )}

      {writingOff && (
        <WriteOffModal
          familyId={family.id}
          person={person}
          loan={writingOff}
          categories={categories}
          onClose={() => setWritingOff(null)}
          onSaved={async (date) => {
            setWritingOff(null);
            toast("Written off");
            invalidateYear(new Date(date).getFullYear());
            await Promise.all([loadHistory(), refreshAccounts().catch(() => undefined)]);
          }}
        />
      )}

      {deleting && (
        <DeletePersonModal
          familyId={family.id}
          encrypted={family.encryptionEnabled}
          person={person}
          people={accounts.filter((a) => isPerson(a) && a.id !== person.id)}
          history={history}
          onClose={() => setDeleting(false)}
          onDone={async (movedTo, message) => {
            setDeleting(false);
            toast(message);
            await afterChange();
            navigate(movedTo ? `/lending/${movedTo}` : "/lending", { replace: true });
          }}
        />
      )}

      {form && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          transaction={form.transaction}
          preset={form.preset}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            invalidateYear(new Date(saved.date).getFullYear());
            loadHistory();
            refreshAccounts().catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/lending" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
      <ArrowLeft size={15} />
      Lend &amp; borrow
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-subtle">{title}</h3>
      {children}
    </section>
  );
}

type PairButton = { title: string; icon: "in" | "out"; onClick: () => void };

function ButtonPair({ primary, secondary }: { primary: PairButton; secondary: PairButton }) {
  const icon = (dir: "in" | "out") => (dir === "out" ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Button icon={icon(primary.icon)} onClick={primary.onClick}>
        {primary.title}
      </Button>
      <Button variant="secondary" icon={icon(secondary.icon)} onClick={secondary.onClick}>
        {secondary.title}
      </Button>
    </div>
  );
}

/** One loan, how much of it has come back (or was written off) and which entries closed it. */
function LoanRow({
  loan,
  currency,
  onOpen,
  onOpenRepayment,
  onRecordReturn,
  onWriteOff,
}: {
  loan: Loan;
  currency: string;
  onOpen?: () => void;
  onOpenRepayment: (t: Transaction) => void;
  onRecordReturn?: () => void;
  onWriteOff?: () => void;
}) {
  const lent = loan.direction === "lent";
  const title = loan.transaction
    ? `${lent ? "You lent" : "You borrowed"} ${formatCurrency(loan.amount, currency)}`
    : `${lent ? "They owed you" : "You owed"} ${formatCurrency(loan.amount, currency)} to start`;
  const detail = [formatDay(loan.date), loan.transaction?.category?.name, loan.transaction?.notes].filter(Boolean).join(" · ");
  const closedByWriteOff = loan.settled && loan.writtenOff > 0 && loan.returned === 0;

  return (
    <li className="space-y-2 p-4">
      <button type="button" disabled={!onOpen} onClick={onOpen} className="flex w-full items-center gap-2.5 text-left disabled:cursor-default">
        {closedByWriteOff ? (
          <Ban size={18} className="shrink-0 text-ink-muted" />
        ) : loan.settled ? (
          <CheckCircle2 size={18} className="shrink-0 text-income" />
        ) : lent ? (
          <ArrowUpRight size={18} className="shrink-0 text-ink-muted" />
        ) : (
          <ArrowDownLeft size={18} className="shrink-0 text-ink-muted" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{title}</span>
          {detail && <span className="block truncate text-xs text-ink-subtle">{detail}</span>}
        </span>
      </button>
      {!loan.settled && <ProgressBar value={(loan.returned + loan.writtenOff) / loan.amount} tone={lent ? "income" : "expense"} />}
      <div className="flex flex-wrap justify-between gap-2 text-xs font-semibold">
        <span className={loan.settled && !closedByWriteOff ? "text-income" : "text-ink-muted"}>{loanStatus(loan, currency)}</span>
        {!loan.settled && loan.dueDate && (
          <span className={loan.overdue ? "text-expense" : "text-ink-muted"}>
            {loan.overdue ? `Overdue since ${formatDay(loan.dueDate)}` : `Return by ${formatDay(loan.dueDate)}`}
          </span>
        )}
      </div>
      {loan.repayments.length > 0 && (
        <ul className="space-y-1 pl-7">
          {loan.repayments.map((r, i) => (
            <li key={`${r.transaction.id}-${i}`}>
              <button type="button" onClick={() => onOpenRepayment(r.transaction)} className="flex w-full items-center gap-2 text-left text-xs text-ink-muted hover:text-ink">
                {r.writtenOff ? <Ban size={13} className="shrink-0 text-ink-subtle" /> : <Undo2 size={13} className="shrink-0 text-ink-subtle" />}
                <span className="truncate">
                  {`${formatCurrency(r.amount, currency)} ${r.writtenOff ? "written off" : "returned"} ${formatDay(new Date(r.transaction.date))}`}
                  {r.transaction.repaysId === loan.transaction?.id ? "" : " · matched automatically"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(onRecordReturn || onWriteOff) && !loan.settled && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 pl-7">
          {onRecordReturn && (
            <button type="button" onClick={onRecordReturn} className="text-xs font-bold text-brand-600 hover:underline">
              {lent ? "Record money got back" : "Record paying back"}
            </button>
          )}
          {onWriteOff && (
            <button type="button" onClick={onWriteOff} className="text-xs font-bold text-ink-muted hover:text-ink hover:underline">
              {lent ? "Won't be returned" : "No need to repay"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function HistoryRow({
  transaction,
  personId,
  repays,
  onClick,
}: {
  transaction: Transaction;
  personId: string;
  /** The loan this entry pays back (or writes off), when it was linked to one. */
  repays: Transaction | null;
  onClick: () => void;
}) {
  const { effect, label, detail } = describeEntry(transaction, personId);
  const writtenOff = isWriteOff(transaction);
  const Icon = writtenOff
    ? Ban
    : transaction.type === "EXPENSE"
      ? ShoppingBag
      : transaction.type === "TRANSFER" && transaction.transferToAccountId === personId
        ? ArrowUpRight
        : ArrowDownLeft;
  const date = formatDay(new Date(transaction.date));

  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition hover:bg-surface-sunken">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-sunken text-ink-muted">
          <Icon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{label}</span>
          <span className="block truncate text-xs text-ink-subtle">{[date, transaction.category?.name, detail].filter(Boolean).join(" · ")}</span>
          {repays && (
            <span className="block truncate text-xs text-brand-600">{`${writtenOff ? "Writes off" : "Pays back"} “${repays.payee || "loan"}” · ${formatDay(new Date(repays.date))}`}</span>
          )}
          {transaction.notes && <span className="line-clamp-2 block text-xs text-ink-muted">{transaction.notes}</span>}
        </span>
        {/* Signed by what it did to the tab: + they owe you more (or you owe less), − the reverse. */}
        <span className={cn("tnum shrink-0 text-sm font-bold", effect > 0 ? "text-income" : "text-expense")}>
          {`${effect > 0 ? "+" : "−"}${formatCurrency(Math.abs(effect), transaction.account.currency)}`}
        </span>
      </button>
    </li>
  );
}

/** Rename, and share with (or keep from) the family. */
function EditPersonModal({ familyId, person, onClose, onSaved }: { familyId: string; person: Account; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(person.name);
  const [shared, setShared] = useState(person.ownerId === null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const changed = name.trim() !== person.name || shared !== (person.ownerId === null);
  const canSave = !!name.trim() && changed;

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.patch(`/families/${familyId}/accounts/${person.id}`, {
        name: name.trim(),
        ...(shared !== (person.ownerId === null) ? { isCommon: shared } : {}),
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save"));
      setIsSaving(false);
    }
  }

  return (
    <Modal
      title="Edit person"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="edit-person" loading={isSaving} disabled={!canSave}>
            Save
          </Button>
        </div>
      }
    >
      <form
        id="edit-person"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) handleSave();
        }}
      >
        <Field label="Name">{(props) => <Input {...props} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Toggle
          checked={shared}
          onChange={setShared}
          label="Share with family"
          description={shared ? "Everyone in the family sees them and what's owed." : "Only you see them and what's owed."}
        />
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

/** Closes (part of) a loan as money that won't come back. */
function WriteOffModal({
  familyId,
  person,
  loan,
  categories,
  onClose,
  onSaved,
}: {
  familyId: string;
  person: Account;
  loan: Loan;
  categories: Category[];
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const lent = loan.direction === "lent";
  const [amount, setAmount] = useState(String(Number(loan.remaining.toFixed(2))));
  const [date, setDate] = useState(() => localDateInput(new Date()));
  const [time, setTime] = useState(() => localTimeInput(new Date()));
  const [counted, setCounted] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const amountValue = Number(amount);
  const when = combineDateTime(date, time);
  const tooMuch = amountValue > loan.remaining + 0.005;
  const canSave = amountValue > 0 && !tooMuch && !!when;

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      const at = when!.toISOString();
      await api.post(`/families/${familyId}/transactions`, writeOffPayload({ person, loan, amount: amountValue, date: at, counted, categoryId, notes }));
      onSaved(at);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to write it off"));
      setIsSaving(false);
    }
  }

  return (
    <Modal
      title={lent ? "Won't be returned" : "No need to repay"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="write-off" variant="danger" loading={isSaving} disabled={!canSave}>
            {`Write off ${amountValue > 0 ? formatCurrency(amountValue, person.currency) : ""}`.trim()}
          </Button>
        </div>
      }
    >
      <form
        id="write-off"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) handleSave();
        }}
      >
        <p className="text-sm text-ink-muted">
          {lent
            ? `${person.name} won't owe you this any more. Your accounts don't change — the money already left them when you lent it.`
            : `You won't owe ${person.name} this any more. Your accounts don't change — the money already came in when you borrowed it.`}
        </p>
        <Field label="Amount" error={tooMuch ? `Only ${formatCurrency(loan.remaining, person.currency)} is left on this loan` : null}>
          {(props) => <Input {...props} type="number" inputMode="decimal" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(props) => <Input {...props} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Time">{(props) => <Input {...props} type="time" required value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        <Toggle
          checked={counted}
          onChange={setCounted}
          label={lent ? "Count it as spending" : "Count it as income"}
          description={
            counted
              ? lent
                ? "Shows up as an expense on this date, in the category you pick."
                : "Shows up as income on this date, in the category you pick."
              : "Off: kept out of income, spending and budgets."
          }
        />
        {counted && (
          <Field label="Category" hint="Optional">
            {(props) => (
              <CategoryPicker
                {...props}
                categories={categories.filter((c) => c.type === (lent ? "EXPENSE" : "INCOME"))}
                selectedId={categoryId}
                onSelect={setCategoryId}
                clearLabel="No category"
              />
            )}
          </Field>
        )}
        <Field label="Notes" hint="Optional">
          {(props) => <Input {...props} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why it won't come back" />}
        </Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}

/**
 * Deletes a person: their entries either move to someone else (or a new group like "Friends"),
 * each keeping the name in its notes, or go to the bin with them.
 */
function DeletePersonModal({
  familyId,
  encrypted,
  person,
  people,
  history,
  onClose,
  onDone,
}: {
  familyId: string;
  encrypted: boolean;
  person: Account;
  people: Account[];
  history: Transaction[];
  onClose: () => void;
  /** With the person their entries moved to, if they moved. */
  onDone: (movedTo: string | null, message: string) => void;
}) {
  const shared = person.ownerId === null;
  // A shared person's entries are the family's, so they can only move to someone shared too.
  const targets = people.filter((p) => !shared || p.ownerId === null);
  const count = history.length;
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [targetId, setTargetId] = useState<string>(() => targets.find((p) => /^friends?$/i.test(p.name))?.id ?? "new");
  const [groupName, setGroupName] = useState("Friends");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const target = targetId === "new" ? null : targets.find((p) => p.id === targetId) ?? null;
  const canSubmit = count === 0 || mode === "delete" || !!target || (targetId === "new" && groupName.trim().length > 0);

  /** For an end-to-end encrypted family the server can't write the name into notes; this browser does. */
  function sealedNotes() {
    if (!encrypted) return undefined;
    if (!hasFamilyKey(familyId)) throw new ClientError("Unlock your vault with your master password first, so their notes can keep the name.");
    return history
      .filter((t) => t.notes !== LOCKED_PLACEHOLDER)
      .map((t) => ({ id: t.id, notes: encryptOutgoing(familyId, { notes: withNameInNotes(person.name, t.notes) }).notes as string }));
  }

  async function handleConfirm() {
    setError(null);
    setIsWorking(true);
    try {
      if (count > 0 && mode === "move") {
        const res = await api.post<Account>(`/families/${familyId}/accounts/${person.id}/merge`, {
          ...(target ? { targetId: target.id } : { newTarget: { name: groupName.trim(), isCommon: shared } }),
          notes: sealedNotes(),
        });
        onDone(res.data.id, `Moved ${person.name}'s entries to ${res.data.name}`);
      } else {
        await api.delete(`/families/${familyId}/accounts/${person.id}`, { params: count > 0 ? { entries: "delete" } : undefined });
        onDone(null, `${person.name} was deleted`);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete"));
      setIsWorking(false);
    }
  }

  return (
    <Modal
      title={`Delete ${person.name}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={isWorking} disabled={!canSubmit} onClick={handleConfirm}>
            {count > 0 && mode === "move" ? `Move entries & delete ${person.name}` : `Delete ${person.name}`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {count === 0 ? (
          <p className="text-sm text-ink-muted">{`Nothing is recorded with ${person.name}, so they're simply removed.`}</p>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {`${count} ${count === 1 ? "entry is" : "entries are"} recorded with ${person.name}. What should happen to ${count === 1 ? "it" : "them"}?`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip selected={mode === "move"} onClick={() => setMode("move")}>
                <Users size={13} />
                Move to someone else
              </Chip>
              <Chip selected={mode === "delete"} color="rgb(var(--c-expense))" onClick={() => setMode("delete")}>
                <Trash2 size={13} />
                Delete them too
              </Chip>
            </div>
            {mode === "move" ? (
              <div className="space-y-3">
                <div>
                  <p className="mb-1.5 text-sm font-medium text-ink-muted">Move to</p>
                  <div className="flex flex-wrap gap-2">
                    {targets.map((p) => (
                      <Chip key={p.id} selected={targetId === p.id} onClick={() => setTargetId(p.id)}>
                        {p.name}
                      </Chip>
                    ))}
                    <Chip selected={targetId === "new"} onClick={() => setTargetId("new")}>
                      <Plus size={13} />
                      New group
                    </Chip>
                  </div>
                </div>
                {targetId === "new" && (
                  <Field label="Group name" hint={shared ? "Shared with the family, like them." : undefined}>
                    {(props) => <Input {...props} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Friends" />}
                  </Field>
                )}
                <p className="text-xs text-ink-subtle">
                  {`Every entry moves to ${target?.name ?? (groupName.trim() || "the group")} with “${person.name}” written in its notes, and what's owed moves with them. Your account balances don't change.`}
                </p>
              </div>
            ) : (
              <p className="text-xs text-expense">
                {`Their entries go to the bin and your account balances change back as if they never happened. Restoring one from the bin brings ${person.name} back.`}
              </p>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Modal>
  );
}
