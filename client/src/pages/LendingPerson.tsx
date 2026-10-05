import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CheckCircle2, Pencil, ShoppingBag, Trash2, Undo2 } from "lucide-react";
import { api } from "../api/client";
import type { Account, Transaction } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { Avatar, Badge, Button, Card, ErrorText, Field, Input, Modal, ProgressBar, SkeletonRows, cn } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import { useFamilyData } from "../context/FamilyDataContext";
import { formatCurrency } from "../lib/format";
import { describeBalance, describeEntry, isSettled, trackLoans, type LendingKind, type Loan } from "../lib/lending";
import { TransactionFormModal, type TransactionPreset } from "../components/transactions/TransactionFormModal";

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type FormState = { preset?: TransactionPreset; transaction?: Transaction };

export function LendingPerson() {
  const { id } = useParams<{ id: string }>();
  const { family } = useOutletContext<LayoutContext>();
  const { accounts, categories, isLoadingStatic, refreshAccounts, invalidateYear } = useFamilyData();
  const canRecord = family.role !== "VIEWER";
  const navigate = useNavigate();

  const person = accounts.find((a) => a.id === id) ?? null;
  const [history, setHistory] = useState<Transaction[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

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
  const returnedLoans = loans.filter((l) => l.settled);

  function record(kind: LendingKind, amount?: number, repaysId?: string) {
    setForm({ preset: { type: "LENDING", kind, personId: id, ...(amount ? { amount } : {}), ...(repaysId ? { repaysId } : {}) } });
  }

  function openTransaction(t: Transaction) {
    setForm({ transaction: t });
  }

  async function handleRemove() {
    setIsRemoving(true);
    try {
      await api.delete(`/families/${family.id}/accounts/${id}`);
      await refreshAccounts();
      navigate("/lending");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to remove"));
      setConfirmRemove(false);
      setIsRemoving(false);
    }
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
                />
              ))}
            </ul>
          </Card>
        </Section>
      )}

      {returnedLoans.length > 0 && (
        <Section title="Returned">
          <Card padded={false}>
            <ul className="divide-y divide-line">
              {returnedLoans.map((loan, i) => (
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

      {canRecord && (
        <div className="space-y-2 pt-2">
          <Button variant="secondary" className="w-full" icon={<Pencil size={15} />} onClick={() => setRenaming(true)}>
            Rename
          </Button>
          {confirmRemove ? (
            <div className="space-y-3 rounded-2xl bg-expense-soft p-4">
              <p className="text-sm font-medium text-ink">
                {settled
                  ? `Remove ${person.name}? Their history stays in your transactions.`
                  : `Remove ${person.name}? ${describeBalance(person.name, balance, person.currency)}, which will no longer be tracked here.`}
              </p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" loading={isRemoving} onClick={handleRemove}>
                  Remove
                </Button>
                <Button variant="secondary" size="sm" disabled={isRemoving} onClick={() => setConfirmRemove(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="w-full text-expense hover:text-expense" icon={<Trash2 size={15} />} onClick={() => setConfirmRemove(true)}>
              Remove person
            </Button>
          )}
        </div>
      )}

      </div>
      </div>

      {renaming && (
        <RenameModal
          familyId={family.id}
          person={person}
          onClose={() => setRenaming(false)}
          onSaved={async () => {
            setRenaming(false);
            await refreshAccounts();
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

/** One loan, how much of it has come back and which entries returned it. */
function LoanRow({
  loan,
  currency,
  onOpen,
  onOpenRepayment,
  onRecordReturn,
}: {
  loan: Loan;
  currency: string;
  onOpen?: () => void;
  onOpenRepayment: (t: Transaction) => void;
  onRecordReturn?: () => void;
}) {
  const lent = loan.direction === "lent";
  const title = loan.transaction
    ? `${lent ? "You lent" : "You borrowed"} ${formatCurrency(loan.amount, currency)}`
    : `${lent ? "They owed you" : "You owed"} ${formatCurrency(loan.amount, currency)} to start`;
  const detail = [formatDay(loan.date), loan.transaction?.category?.name, loan.transaction?.notes].filter(Boolean).join(" · ");

  let status: string;
  if (loan.settled) status = "Fully returned";
  else if (loan.returned > 0) status = `${formatCurrency(loan.returned, currency)} returned · ${formatCurrency(loan.remaining, currency)} left`;
  else status = `${formatCurrency(loan.remaining, currency)} left`;

  return (
    <li className="space-y-2 p-4">
      <button type="button" disabled={!onOpen} onClick={onOpen} className="flex w-full items-center gap-2.5 text-left disabled:cursor-default">
        {loan.settled ? (
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
      {!loan.settled && <ProgressBar value={loan.returned / loan.amount} tone={lent ? "income" : "expense"} />}
      <div className="flex flex-wrap justify-between gap-2 text-xs font-semibold">
        <span className={loan.settled ? "text-income" : "text-ink-muted"}>{status}</span>
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
                <Undo2 size={13} className="shrink-0 text-ink-subtle" />
                <span className="truncate">
                  {`${formatCurrency(r.amount, currency)} returned ${formatDay(new Date(r.transaction.date))}`}
                  {r.transaction.repaysId === loan.transaction?.id ? "" : " · matched automatically"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {onRecordReturn && !loan.settled && (
        <button type="button" onClick={onRecordReturn} className="pl-7 text-xs font-bold text-brand-600 hover:underline">
          {lent ? "Record money got back" : "Record paying back"}
        </button>
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
  /** The loan this entry pays back, when it was linked to one. */
  repays: Transaction | null;
  onClick: () => void;
}) {
  const { effect, label, detail } = describeEntry(transaction, personId);
  const isExpense = transaction.type === "EXPENSE";
  const Icon = isExpense ? ShoppingBag : transaction.type === "TRANSFER" && transaction.transferToAccountId === personId ? ArrowUpRight : ArrowDownLeft;
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
            <span className="block truncate text-xs text-brand-600">{`Pays back “${repays.payee || "loan"}” · ${formatDay(new Date(repays.date))}`}</span>
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

function RenameModal({ familyId, person, onClose, onSaved }: { familyId: string; person: Account; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(person.name);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.patch(`/families/${familyId}/accounts/${person.id}`, { name: name.trim() });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to rename"));
      setIsSaving(false);
    }
  }

  const canSave = !!name.trim() && name.trim() !== person.name;

  return (
    <Modal
      title="Rename"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="rename-person" loading={isSaving} disabled={!canSave}>
            Save
          </Button>
        </div>
      }
    >
      <form
        id="rename-person"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) handleSave();
        }}
      >
        <Field label="Name">{(props) => <Input {...props} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}
