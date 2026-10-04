import { useEffect, useState, useMemo } from "react";
import { useParams, useOutletContext, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Account, Transaction } from "../api/types";
import { Button, Card, SkeletonRows, ErrorText, ProgressBar } from "../components/ui";
import { Money } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import { trackLoans } from "../lib/lending";

export function LendingPerson() {
  const { id } = useParams<{ id: string }>();
  const { family } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Account | null>(null);
  const [history, setHistory] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Account[]>(`/families/${family.id}/accounts`),
      api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { accountId: id, limit: 5000 } })
    ]).then(([accRes, txRes]) => {
      const found = accRes.data.find(a => a.id === id);
      if (found) {
        setPerson(found);
        setHistory(txRes.data);
      } else {
        setError("Person not found");
      }
      setIsLoading(false);
    }).catch(err => {
      setError(err.message);
      setIsLoading(false);
    });
  }, [family.id, id]);

  const loans = useMemo(() => person ? trackLoans(history, person) : [], [history, person]);

  if (isLoading) return <Card><SkeletonRows rows={5} /></Card>;
  if (error || !person) return <ErrorText>{error}</ErrorText>;

  const openLoans = loans.filter(l => !l.settled);
  const returnedLoans = loans.filter(l => l.settled);

  return (
    <div className="space-y-6">
      <Card className="items-center justify-center text-center py-6">
        <h2 className="text-xl font-bold text-ink">{person.name}</h2>
        <Money amount={Math.abs(person.balance)} currency={person.currency} tone={person.balance > 0 ? "income" : person.balance < 0 ? "expense" : "auto"} className="text-2xl font-bold" />
        <p className="text-xs text-ink-subtle">{person.balance > 0 ? "Owes you" : person.balance < 0 ? "You owe" : "Settled up"}</p>
      </Card>

      <div className="flex gap-4">
        <Button onClick={() => navigate(`/transaction-form?type=LENDING&kind=lent&personId=${id}`)}>Lend</Button>
        <Button variant="secondary" onClick={() => navigate(`/transaction-form?type=LENDING&kind=borrowed&personId=${id}`)}>Borrow</Button>
      </div>

      {openLoans.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase text-ink-subtle mb-2">Waiting to be returned</h3>
          <Card className="!p-0">
            <ul className="divide-y divide-line">
              {openLoans.map((l, i) => (
                <li key={i} className="p-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-bold text-ink">{l.direction === "lent" ? "You lent" : "You borrowed"} <Money amount={l.amount} currency={person.currency} /></p>
                      <p className="text-xs text-ink-subtle">{new Date(l.date).toLocaleDateString()} · {l.remaining} left</p>
                    </div>
                  </div>
                  <div className="mt-2">
                     <ProgressBar value={l.returned / l.amount} tone={l.direction === "lent" ? "income" : "expense"} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {returnedLoans.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase text-ink-subtle mb-2">Returned</h3>
          <Card className="!p-0">
            <ul className="divide-y divide-line">
              {returnedLoans.map((l, i) => (
                <li key={i} className="p-4">
                  <p className="font-bold text-ink">{l.direction === "lent" ? "You lent" : "You borrowed"} <Money amount={l.amount} currency={person.currency} /></p>
                  <p className="text-xs text-ink-subtle">{new Date(l.date).toLocaleDateString()} · Fully returned</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
