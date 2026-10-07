import { useState, useEffect } from "react";
import { ArchiveRestore, RefreshCcw, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Card, CardHeader, ErrorText, IconButton, SkeletonRows, useToast, Modal } from "../ui";
import { useFamilyData } from "../../context/FamilyDataContext";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";
import { formatTime } from "../../lib/dateUtils";

const RETENTION_DAYS = 30;

function describe(t: Transaction) {
  return t.payee || t.category?.name || (t.type === "TRANSFER" ? "Transfer" : t.type === "INCOME" ? "Income" : "Expense");
}

export function BinManager({ familyId }: { familyId: string }) {
  const toast = useToast();
  const { invalidateAll, refreshAccounts } = useFamilyData();
  const [isOpen, setIsOpen] = useState(false);
  const [binned, setBinned] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The entry waiting for a second click before it's deleted for good.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function loadBin() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<Transaction[]>(`/families/${familyId}/transactions`, { params: { bin: "true", limit: 200 } });
      setBinned(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't load the bin"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadBin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function handleRestore(t: Transaction) {
    try {
      await api.post(`/families/${familyId}/transactions/${t.id}/restore`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
      invalidateAll();
      await refreshAccounts();
      toast("Transaction restored");
    } catch (err) {
      toast(getErrorMessage(err, "Couldn't restore it"), "error");
    }
  }

  async function handlePurge(t: Transaction) {
    try {
      await api.delete(`/families/${familyId}/transactions/${t.id}/purge`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
      setConfirmingId(null);
      toast("Deleted for good");
    } catch (err) {
      toast(getErrorMessage(err, "Couldn't delete it"), "error");
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Recycle bin"
          subtitle={`Deleted transactions stay here for ${RETENTION_DAYS} days.`}
          icon={<ArchiveRestore size={17} />}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setIsOpen(true)}>
              Open bin
            </Button>
          }
        />
      </Card>

      {isOpen && (
        <Modal onClose={() => setIsOpen(false)} title="Recycle bin" description={`Deleted for good after ${RETENTION_DAYS} days. Restoring puts an entry back in your balances.`}>
          <ErrorText>{error}</ErrorText>
          {isLoading ? (
            <SkeletonRows rows={3} />
          ) : binned.length === 0 ? (
            <p className="text-sm text-ink-subtle">The bin is empty.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
              {binned.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{describe(t)}</p>
                    <p className="truncate text-xs text-ink-subtle">
                      {new Date(t.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, {formatTime(t.date)} ·{" "}
                      {t.account.name}
                      {t.deletedAt ? ` · deleted ${new Date(t.deletedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                    </p>
                  </div>
                  {confirmingId === t.id ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="danger" size="sm" onClick={() => handlePurge(t)}>
                        Delete for good
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="mr-1 text-sm font-semibold">
                        <Money amount={t.type === "EXPENSE" ? -t.amount : t.amount} currency={t.account.currency} signed={t.type !== "TRANSFER"} />
                      </span>
                      <IconButton label={`Restore ${describe(t)}`} onClick={() => handleRestore(t)}>
                        <RefreshCcw size={15} />
                      </IconButton>
                      <IconButton label={`Delete ${describe(t)} for good`} tone="danger" onClick={() => setConfirmingId(t.id)}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}
