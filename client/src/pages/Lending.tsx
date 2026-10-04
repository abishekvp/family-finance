import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useNavigate } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, HandCoins } from "lucide-react";
import { api } from "../api/client";
import type { Account } from "../api/types";
import { Button, Card, EmptyState, SkeletonRows } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import { isPerson } from "../lib/lending";

const EPSILON = 0.005;
const isSettled = (b: number) => Math.abs(b) < EPSILON;

export function Lending() {
  const { family } = useOutletContext<LayoutContext>();
  
  const navigate = useNavigate();
  const [people, setPeople] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.get<Account[]>(`/families/${family.id}/accounts`)
      .then(res => {
        setPeople(res.data.filter(isPerson));
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [family.id]);

  const { owedToYou, youOwe } = useMemo(() => {
    let owed = 0;
    let owe = 0;
    for (const p of people) {
      const b = p.balance ?? 0;
      if (b > 0) owed += b;
      else if (b < 0) owe += Math.abs(b);
    }
    return { owedToYou: owed, youOwe: owe };
  }, [people]);

  const open = people.filter((p) => !isSettled(p.balance ?? 0)).sort((a, b) => Math.abs(b.balance ?? 0) - Math.abs(a.balance ?? 0));
  const settled = people.filter((p) => isSettled(p.balance ?? 0));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatTile label="Owed to you" value={owedToYou} currency={family.currency} tone="income" loading={isLoading} />
        <StatTile label="You owe" value={youOwe} currency={family.currency} tone="expense" loading={isLoading} />
      </div>

      <div className="flex gap-4">
        <Button icon={<ArrowUpRight size={16} />} onClick={() => navigate("/transaction-form?type=LENDING&kind=lent")}>Lend</Button>
        <Button variant="secondary" icon={<ArrowDownLeft size={16} />} onClick={() => navigate("/transaction-form?type=LENDING&kind=borrowed")}>Borrow</Button>
      </div>

      {isLoading ? (
        <Card><SkeletonRows rows={3} /></Card>
      ) : people.length === 0 ? (
        <EmptyState title="Nothing lent or borrowed" description="Track money you lend to friends or borrow from them." icon={<HandCoins size={20} />} />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase text-ink-subtle mb-2">Open</h3>
              <Card className="!p-0">
                <ul className="divide-y divide-line">
                  {open.map(p => (
                    <li key={p.id}>
                      <Link to={`/lending/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-surface-sunken">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-ink truncate">{p.name}</p>
                          <p className="text-xs text-ink-subtle mt-1">
                            {(p.balance ?? 0) > 0 ? "Owes you" : "You owe"} {p.owner ? "" : "· Shared"}
                          </p>
                        </div>
                        <Money amount={Math.abs(p.balance ?? 0)} currency={p.currency} tone={(p.balance ?? 0) > 0 ? "income" : "expense"} className="font-bold" />
                        <ChevronRight size={16} className="text-ink-subtle" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
          {settled.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase text-ink-subtle mb-2">Settled up</h3>
              <Card className="!p-0">
                <ul className="divide-y divide-line">
                  {settled.map(p => (
                    <li key={p.id}>
                      <Link to={`/lending/${p.id}`} className="flex items-center gap-4 p-4 hover:bg-surface-sunken">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-ink truncate">{p.name}</p>
                          <p className="text-xs text-ink-subtle mt-1">Settled up</p>
                        </div>
                        <ChevronRight size={16} className="text-ink-subtle" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
