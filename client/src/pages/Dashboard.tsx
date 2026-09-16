import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, EmptyState, ErrorText, Spinner } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import type { Account, Category, Transaction } from "../api/types";
import { formatCurrency } from "../lib/format";
import { TransactionRow } from "../components/transactions/TransactionRow";
import { TransactionFormModal } from "../components/transactions/TransactionFormModal";

// A genuine at-a-glance overview. Full account management now lives on Accounts.tsx and
// the full transaction list/filters/period views live on Transactions.tsx.
export function Dashboard() {
  const { family, scope } = useOutletContext<LayoutContext>();
  const { user } = useAuth();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [accountsRes, categoriesRes, transactionsRes] = await Promise.all([
        api.get<Account[]>(`/families/${family.id}/accounts`),
        api.get<Category[]>(`/families/${family.id}/categories`),
        api.get<Transaction[]>(`/families/${family.id}/transactions`, { params: { limit: 5 } }),
      ]);
      setAccounts(accountsRes.data);
      setCategories(categoriesRes.data);
      setTransactions(transactionsRes.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load your dashboard"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family.id]);

  const visibleAccounts = scope === "family" ? accounts : accounts.filter((a) => a.owner?.id === user!.id);
  const netWorth = visibleAccounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-sm text-slate-500">{scope === "family" ? "Family" : "Your"} net worth</p>
          {isLoading ? (
            <p className="mt-2 text-2xl font-semibold text-slate-300 dark:text-slate-700">···</p>
          ) : (
            <p className="mt-2 text-2xl font-semibold">{formatCurrency(netWorth, family.currency)}</p>
          )}
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Across {visibleAccounts.length} account{visibleAccounts.length === 1 ? "" : "s"}
          </p>
        </Card>
        <Card className="flex flex-col justify-center gap-3">
          <p className="text-sm text-slate-500">Quick actions</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setShowAddTransaction(true)}>
              <Plus size={16} className="mr-1.5" />
              Add transaction
            </Button>
            <Link to="/accounts">
              <Button variant="secondary">Manage accounts</Button>
            </Link>
          </div>
        </Card>
      </div>

      <ErrorText>{error}</ErrorText>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent transactions</h2>
          <Link
            to="/transactions"
            className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            View all
            <ArrowRight size={14} />
          </Link>
        </div>

        {isLoading ? (
          <Spinner label="Loading transactions..." />
        ) : transactions.length === 0 ? (
          <EmptyState title="No transactions yet" description="Add your first transaction to see it here." />
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {transactions.map((t) => (
              <TransactionRow key={t.id} transaction={t} onClick={() => setEditingTransaction(t)} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link to="/transactions">
          <Card className="flex h-full items-center justify-between transition-colors hover:border-brand-300 dark:hover:border-brand-700">
            <span className="text-sm font-medium">Transactions</span>
            <ArrowRight size={16} className="text-slate-400" />
          </Card>
        </Link>
        <Link to="/stats">
          <Card className="flex h-full items-center justify-between transition-colors hover:border-brand-300 dark:hover:border-brand-700">
            <span className="text-sm font-medium">Stats</span>
            <ArrowRight size={16} className="text-slate-400" />
          </Card>
        </Link>
        <Link to="/accounts">
          <Card className="flex h-full items-center justify-between transition-colors hover:border-brand-300 dark:hover:border-brand-700">
            <span className="text-sm font-medium">Accounts</span>
            <ArrowRight size={16} className="text-slate-400" />
          </Card>
        </Link>
      </div>

      {(showAddTransaction || editingTransaction) && (
        <TransactionFormModal
          familyId={family.id}
          accounts={accounts}
          categories={categories}
          transaction={editingTransaction}
          onClose={() => {
            setShowAddTransaction(false);
            setEditingTransaction(null);
          }}
          onSaved={load}
        />
      )}
    </div>
  );
}
