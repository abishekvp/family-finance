import { useEffect, useState } from "react";
import { Link, useOutletContext, useNavigate } from "react-router-dom";
import { Plus, Repeat } from "lucide-react";
import { api } from "../api/client";
import type { RecurringTransaction } from "../api/types";
import { Button, Card, EmptyState, SkeletonRows, Badge } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";

export function Recurring() {
  const { family } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.get<RecurringTransaction[]>(`/families/${family.id}/recurring`)
      .then(res => {
        setRules(res.data);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [family.id]);

  const active = rules.filter(r => r.isActive);
  const expenses = active.filter(r => r.type === "EXPENSE");
  const monthlyOut = expenses.filter(r => r.frequency !== "YEARLY").reduce((sum, r) => sum + (r.frequency === "WEEKLY" ? (r.amount * 52) / 12 : r.amount), 0);
  const yearlyOut = expenses.filter(r => r.frequency === "YEARLY").reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatTile label="Every month" value={monthlyOut} currency={family.currency} tone="expense" loading={isLoading} />
        <StatTile label="Every year" value={yearlyOut} currency={family.currency} tone="expense" loading={isLoading} />
      </div>

      <Button icon={<Plus size={16} />} onClick={() => navigate("/recurring/new")}>Add repeating payment</Button>

      {isLoading ? (
        <Card><SkeletonRows rows={3} /></Card>
      ) : rules.length === 0 ? (
        <EmptyState title="No repeating payments" description="Add a salary, rent, or a subscription once, and it's recorded every time it's due." icon={<Repeat size={20} />} />
      ) : (
        <div className="space-y-6">
          {["MONTHLY", "YEARLY", "WEEKLY"].map(freq => {
            const list = active.filter(r => r.frequency === freq);
            if (list.length === 0) return null;
            return (
              <div key={freq}>
                <h3 className="text-xs font-bold uppercase text-ink-subtle mb-2">{freq.toLowerCase()}</h3>
                <Card className="!p-0">
                  <ul className="divide-y divide-line">
                    {list.map(r => (
                      <li key={r.id}>
                        <Link to={`/recurring/${r.id}`} className="flex items-center gap-4 p-4 hover:bg-surface-sunken">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-ink truncate">{r.payee || r.category?.name || "Payment"}</p>
                            <p className="text-xs text-ink-subtle mt-1">Next {r.nextDate}</p>
                          </div>
                          <Money amount={r.amount} currency={r.account.currency} tone={r.type === "EXPENSE" ? "expense" : "income"} className="font-bold" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
