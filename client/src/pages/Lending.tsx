import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, HandCoins } from "lucide-react";
import { api } from "../api/client";
import type { Account, Transaction } from "../api/types";
import { Avatar, Badge, Button, Card, EmptyState, ErrorText, SkeletonRows } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import { useFamilyData } from "../context/FamilyDataContext";
import { getErrorMessage } from "../api/errors";
import { TransactionFormModal, type TransactionPreset } from "../components/transactions/TransactionFormModal";
import { balanceStatus, isPerson, isSettled, lendingTotals, nextDue, trackLoans } from "../lib/lending";

type Due = { dueDate: Date | null; overdue: boolean };

export function Lending() {
  const { family } = useOutletContext<LayoutContext>();
  const { accounts, categories, isLoadingStatic, staticError, invalidateYear } = useFamilyData();
  const canRecord = family.role !== "VIEWER";
  const people = useMemo(() => accounts.filter(isPerson), [accounts]);
  // Per person with money outstanding: the earliest return-by date, and whether any is overdue.
  const [dues, setDues] = useState<Record<string, Due>>({});
  const [duesError, setDuesError] = useState<string | null>(null);
  const [preset, setPreset] = useState<TransactionPreset | null>(null);
  const [version, setVersion] = useState(0);

  const openIds = useMemo(
    () =>
      people
        .filter((p) => !isSettled(p.balance ?? 0))
        .map((p) => p.id)
        .join(","),
    [people]
  );

  useEffect(() => {
    if (!openIds) {
      setDues({});
      return;
    }
    let cancelled = false;
    const open = people.filter((p) => !isSettled(p.balance ?? 0));
    Promise.all(
      open.map((p) =>
        api
          .get<Transaction[]>(`/families/${family.id}/transactions`, { params: { accountId: p.id, limit: 5000 } })
          .then((res) => [p.id, nextDue(trackLoans(res.data, p))] as const)
      )
    )
      .then((entries) => {
        if (!cancelled) setDues(Object.fromEntries(entries));
      })
      .catch((err) => !cancelled && setDuesError(getErrorMessage(err, "Unable to load return dates")));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id, openIds, version]);

  const { owedToYou, youOwe } = lendingTotals(people);
  const open = people.filter((p) => !isSettled(p.balance ?? 0)).sort((a, b) => Math.abs(b.balance ?? 0) - Math.abs(a.balance ?? 0));
  const settled = people.filter((p) => isSettled(p.balance ?? 0));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:max-w-3xl">
        <StatTile label="Owed to you" value={owedToYou} currency={family.currency} accent="income" tone="income" loading={isLoadingStatic} />
        <StatTile label="You owe" value={youOwe} currency={family.currency} accent="expense" tone="expense" loading={isLoadingStatic} />
      </div>

      {canRecord && (
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <Button icon={<ArrowUpRight size={16} />} onClick={() => setPreset({ type: "LENDING", kind: "lent" })}>
            Lend
          </Button>
          <Button variant="secondary" icon={<ArrowDownLeft size={16} />} onClick={() => setPreset({ type: "LENDING", kind: "borrowed" })}>
            Borrow
          </Button>
        </div>
      )}

      <p className="text-xs leading-relaxed text-ink-subtle">
        Money you lend or borrow moves between your accounts and the person, so it changes your balances but never counts as income or an
        expense.
      </p>

      <ErrorText>{staticError || duesError}</ErrorText>

      {isLoadingStatic ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : people.length === 0 ? (
        <EmptyState
          title="Nothing lent or borrowed"
          description="Track money you lend to friends or borrow from them, and what's been paid back."
          icon={<HandCoins size={20} />}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {open.length > 0 && <PeopleList title="Open" people={open} dues={dues} />}
          {settled.length > 0 && <PeopleList title="Settled up" people={settled} dues={dues} />}
        </div>
      )}

      {preset && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          preset={preset}
          onClose={() => setPreset(null)}
          onSaved={(saved) => {
            invalidateYear(new Date(saved.date).getFullYear());
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function PeopleList({ title, people, dues }: { title: string; people: Account[]; dues: Record<string, Due> }) {
  return (
    <section>
      <h3 className="mb-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-subtle">{title}</h3>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {people.map((p) => {
            const balance = p.balance ?? 0;
            const settled = isSettled(balance);
            const due = settled ? null : dues[p.id];
            return (
              <li key={p.id}>
                <Link to={`/lending/${p.id}`} className="flex items-center gap-3 rounded-2xl p-4 transition hover:bg-surface-sunken">
                  <Avatar name={p.name} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{p.name}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">
                      {balanceStatus(balance)}
                      {p.owner ? "" : " · Shared"}
                      {due?.dueDate && !due.overdue ? ` · Return by ${due.dueDate.toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                    </p>
                  </div>
                  {due?.overdue && <Badge tone="expense">Overdue</Badge>}
                  {!settled && <Money amount={Math.abs(balance)} currency={p.currency} tone={balance > 0 ? "income" : "expense"} className="text-sm font-bold" />}
                  <ChevronRight size={16} className="shrink-0 text-ink-subtle" />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
