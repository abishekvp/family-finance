import { useCallback, useEffect, useState } from "react";
import { APPROVALS_CHANGED } from "../lib/events";
import { useOutletContext } from "react-router-dom";
import { format } from "date-fns";
import { Check, ClipboardCheck, X } from "lucide-react";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import type { Account, ApprovalStatus, Category, Transaction } from "../api/types";
import { useAuth } from "../context/AuthContext";
import type { LayoutContext } from "../components/Layout";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorText, Segmented, SkeletonRows, useToast } from "../components/ui";
import { TransactionRow } from "../components/transactions/TransactionRow";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";

interface Member {
  userId: string;
  name: string;
}

type Filter = "PENDING" | "REJECTED";

/**
 * Transactions waiting for an admin. Admins approve or reject them here; members see what they've
 * recorded that doesn't count yet, and can fix a rejected entry, which sends it back for approval.
 */
export function Approvals() {
  const { family } = useOutletContext<LayoutContext>();
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = family.role === "ADMIN";

  const [filter, setFilter] = useState<Filter>("PENDING");
  const [transactions, setTransactions] = useState<Transaction[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get<Transaction[]>(`/families/${family.id}/transactions`, {
        params: { approval: filter, limit: 500 },
      });
      // Members only follow their own entries; admins review everyone's.
      setTransactions(isAdmin ? res.data : res.data.filter((t) => t.userId === user!.id));
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load approvals"));
      setTransactions([]);
    }
  }, [family.id, filter, isAdmin, user]);

  useEffect(() => {
    setTransactions(null);
    load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      api.get<Member[]>(`/families/${family.id}/members`),
      api.get<Account[]>(`/families/${family.id}/accounts`),
      api.get<Category[]>(`/families/${family.id}/categories`),
    ])
      .then(([m, a, c]) => {
        setMembers(m.data);
        setAccounts(a.data);
        setCategories(c.data);
      })
      .catch(() => undefined);
  }, [family.id]);

  async function review(ids: string[], decision: "APPROVE" | "REJECT", key: string) {
    setBusy(key);
    setError(null);
    try {
      await api.post(`/families/${family.id}/transactions/approvals/review`, { ids, decision });
      toast(decision === "APPROVE" ? (ids.length > 1 ? `Approved ${ids.length} transactions` : "Approved") : "Rejected");
      window.dispatchEvent(new Event(APPROVALS_CHANGED));
      await load();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the review"));
    } finally {
      setBusy(null);
    }
  }

  const memberName = (userId: string) =>
    userId === user!.id ? "You" : members.find((m) => m.userId === userId)?.name ?? "A family member";

  const list = transactions ?? [];

  return (
    <div className="space-y-5">
      {!family.requireApproval && (
        <p className="rounded-2xl border border-line bg-surface-sunken/60 px-4 py-3 text-sm text-ink-muted">
          Approvals are off, so new transactions count straight away.{" "}
          {isAdmin ? "Turn them on in Family settings." : "An admin can turn them on."} Anything still listed here was recorded
          while they were on.
        </p>
      )}

      <Card>
        <CardHeader
          title={isAdmin ? "Waiting for your approval" : "Your transactions awaiting approval"}
          subtitle="These are saved but don't count toward balances, budgets or totals until approved."
          icon={<ClipboardCheck size={17} />}
          actions={
            isAdmin && filter === "PENDING" && list.length > 1 ? (
              <Button
                size="sm"
                icon={<Check size={14} />}
                loading={busy === "all"}
                onClick={() => review(list.map((t) => t.id), "APPROVE", "all")}
              >
                Approve all
              </Button>
            ) : undefined
          }
        />

        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          className="mb-3"
          options={[
            { value: "PENDING", label: "Pending" },
            { value: "REJECTED", label: "Rejected" },
          ]}
        />

        <ErrorText>{error}</ErrorText>

        {transactions === null ? (
          <SkeletonRows rows={3} />
        ) : list.length === 0 ? (
          <EmptyState
            title={filter === "PENDING" ? "Nothing waiting" : "Nothing rejected"}
            description={
              filter === "PENDING"
                ? "Transactions that need an admin's approval show up here."
                : "Rejected transactions stay here so they can be fixed or deleted."
            }
            icon={<ClipboardCheck size={18} />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {list.map((t) => (
              <li key={t.id} className="py-1">
                <TransactionRow transaction={t} showDate onClick={t.userId === user!.id || isAdmin ? () => setEditing(t) : undefined} />
                <div className="flex flex-wrap items-center gap-2 pb-2 text-xs text-ink-subtle">
                  <span>
                    {memberName(t.userId)} · {format(new Date(t.date), "d MMM yyyy")}
                  </span>
                  <ApprovalBadge status={t.approvalStatus} />
                  {isAdmin && (
                    <span className="ml-auto flex gap-2">
                      {filter === "PENDING" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<X size={14} />}
                          loading={busy === `reject:${t.id}`}
                          onClick={() => review([t.id], "REJECT", `reject:${t.id}`)}
                        >
                          Reject
                        </Button>
                      )}
                      <Button
                        size="sm"
                        icon={<Check size={14} />}
                        loading={busy === `approve:${t.id}`}
                        onClick={() => review([t.id], "APPROVE", `approve:${t.id}`)}
                      >
                        Approve
                      </Button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          transaction={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            window.dispatchEvent(new Event(APPROVALS_CHANGED));
            load();
          }}
        />
      )}
    </div>
  );
}

export function ApprovalBadge({ status }: { status?: ApprovalStatus }) {
  if (status === "PENDING") return <Badge tone="warn">Pending approval</Badge>;
  if (status === "REJECTED") return <Badge tone="expense">Rejected</Badge>;
  return null;
}
