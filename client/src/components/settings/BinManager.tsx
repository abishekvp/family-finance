import { useState, useEffect } from "react";
import { ArchiveRestore, RefreshCcw, Trash } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Card, CardHeader, ErrorText, useToast, Modal } from "../ui";
import { useFamilyData } from "../../context/FamilyDataContext";
import type { Transaction } from "../../api/types";
import { Money } from "../figures";

export function BinManager({ familyId }: { familyId: string }) {
  const toast = useToast();
  const { invalidateAll, refreshAccounts } = useFamilyData();
  const [isOpen, setIsOpen] = useState(false);
  const [binned, setBinned] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBin() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<Transaction[]>(`/families/${familyId}/transactions?bin=true&limit=100`);
      setBinned(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load bin"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadBin();
    }
  }, [isOpen]);

  async function handleRestore(t: Transaction) {
    try {
      await api.post(`/families/${familyId}/transactions/${t.id}/restore`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
      invalidateAll();
      await refreshAccounts();
      toast("Transaction restored");
    } catch (err) {
      toast(getErrorMessage(err, "Failed to restore"), "error");
    }
  }

  async function handlePurge(t: Transaction) {
    try {
      await api.delete(`/families/${familyId}/transactions/${t.id}/purge`);
      setBinned((prev) => prev.filter((x) => x.id !== t.id));
      toast("Transaction permanently deleted");
    } catch (err) {
      toast(getErrorMessage(err, "Failed to delete"), "error");
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Recycle Bin"
          subtitle="View and restore recently deleted transactions."
          icon={<ArchiveRestore size={17} />}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setIsOpen(true)}>
              Open Bin
            </Button>
          }
        />
      </Card>

      {isOpen && (
        <Modal onClose={() => setIsOpen(false)} title="Recycle Bin">
          {error && <ErrorText>{error}</ErrorText>}
        {isLoading ? (
          <p className="text-ink-subtle">Loading...</p>
        ) : binned.length === 0 ? (
          <p className="text-ink-subtle">The bin is empty.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {binned.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl border border-line bg-surface">
                <div>
                  <div className="font-semibold text-ink">
                    {t.payee || t.category?.name || "Transfer"}
                  </div>
                  <div className="text-xs text-ink-subtle">
                    {new Date(t.date).toLocaleDateString()} &middot; Deleted {t.deletedAt ? new Date(t.deletedAt).toLocaleDateString() : 'recently'}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="font-semibold">
                    <Money amount={t.amount} currency={t.account.currency} />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => handleRestore(t)} title="Restore">
                    <RefreshCcw size={15} />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600" onClick={() => handlePurge(t)} title="Purge">
                    <Trash size={15} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        </Modal>
      )}
    </>
  );
}
