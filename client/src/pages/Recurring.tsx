import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { Plus, Repeat } from "lucide-react";
import { api } from "../api/client";
import type { RecurringFrequency, RecurringTransaction } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { Badge, Button, Card, EmptyState, ErrorText, SkeletonRows } from "../components/ui";
import { Money, StatTile } from "../components/figures";
import type { LayoutContext } from "../components/Layout";
import { initials } from "../lib/format";
import { describeSchedule, formatDayShort, perMonth } from "../lib/recurring";

const SECTIONS: { frequency: RecurringFrequency; title: string }[] = [
  { frequency: "MONTHLY", title: "Monthly" },
  { frequency: "YEARLY", title: "Yearly" },
  { frequency: "WEEKLY", title: "Weekly" },
];

export function Recurring() {
  const { family } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();
  const canRecord = family.role !== "VIEWER";
  const [rules, setRules] = useState<RecurringTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<RecurringTransaction[]>(`/families/${family.id}/recurring`)
      .then((res) => setRules(res.data))
      .catch((err) => setError(getErrorMessage(err, "Unable to load repeating payments")))
      .finally(() => setIsLoading(false));
  }, [family.id]);

  const active = rules.filter((r) => r.isActive);
  const stopped = rules.filter((r) => !r.isActive);
  const expenses = active.filter((r) => r.type === "EXPENSE");
  const monthlyOut = expenses.filter((r) => r.frequency !== "YEARLY").reduce((sum, r) => sum + perMonth(r), 0);
  const yearlyOut = expenses.filter((r) => r.frequency === "YEARLY").reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 xl:max-w-3xl">
        <StatTile label="Every month" value={monthlyOut} currency={family.currency} accent="expense" tone="expense" loading={isLoading} />
        <StatTile label="Every year" value={yearlyOut} currency={family.currency} accent="expense" tone="expense" loading={isLoading} />
      </div>

      {canRecord && (
        <Button icon={<Plus size={16} />} onClick={() => navigate("/recurring/new")}>
          Add repeating payment
        </Button>
      )}

      <p className="text-xs leading-relaxed text-ink-subtle">
        Each payment is recorded automatically on its day. Monthly and weekly ones count in your monthly budget, yearly ones in your yearly
        budget.
      </p>

      <ErrorText>{error}</ErrorText>

      {isLoading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : rules.length === 0 ? (
        <EmptyState
          title="No repeating payments"
          description="Add a salary, rent, a home maker's pay or a subscription once, and it's recorded every time it's due."
          icon={<Repeat size={20} />}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {SECTIONS.map((section) => {
            const list = active.filter((r) => r.frequency === section.frequency);
            return list.length === 0 ? null : <RuleList key={section.frequency} title={section.title} rules={list} />;
          })}
          {stopped.length > 0 && <RuleList title="Paused or ended" rules={stopped} />}
        </div>
      )}
    </div>
  );
}

function RuleList({ title, rules }: { title: string; rules: RecurringTransaction[] }) {
  return (
    <section>
      <h3 className="mb-2 px-0.5 text-xs font-bold uppercase tracking-wide text-ink-subtle">{title}</h3>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {rules.map((rule) => {
            const name = rule.payee || rule.category?.name || "Repeating payment";
            const detail = [rule.isActive ? `Next ${formatDayShort(rule.nextDate)}` : describeSchedule(rule), rule.account.name, rule.category?.name]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={rule.id}>
                <Link to={`/recurring/${rule.id}`} className="flex items-center gap-3 rounded-2xl p-4 transition hover:bg-surface-sunken">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-bold text-white"
                    style={{ backgroundColor: rule.category?.color ?? "#94A3B8" }}
                  >
                    {initials(name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{name}</p>
                    <p className="truncate text-xs text-ink-subtle">{detail}</p>
                    {rule.isActive && <p className="truncate text-2xs text-ink-muted">{describeSchedule(rule)}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Money
                      amount={rule.type === "EXPENSE" ? -rule.amount : rule.amount}
                      currency={rule.account.currency}
                      tone={rule.type === "EXPENSE" ? "expense" : "income"}
                      signed
                      className="text-sm font-bold"
                    />
                    {!rule.isActive && <Badge>{rule.endDate && rule.nextDate > rule.endDate ? "Ended" : "Paused"}</Badge>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
