import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Card, CardHeader, ErrorText, Field, Input, useToast } from "../ui";
import { useFamilyData } from "../../context/FamilyDataContext";

export function BulkDeleteCard({ familyId }: { familyId: string }) {
  const toast = useToast();
  const { invalidateAll, refreshAccounts } = useFamilyData();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConfirming(true);
  }

  async function purge() {
    setConfirming(false);
    setError(null);
    setIsDeleting(true);
    try {
      const payload: Record<string, string> = {};
      // Local midnight of each picked day, not UTC midnight.
      if (from) payload.from = new Date(`${from}T00:00:00`).toISOString();
      if (to) payload.to = new Date(`${to}T00:00:00`).toISOString();

      const res = await api.post<{ deletedCount: number }>(`/families/${familyId}/transactions/bulk-delete`, payload);
      invalidateAll();
      await refreshAccounts();
      toast(`Moved ${res.data.deletedCount} transactions to bin`);
      setFrom("");
      setTo("");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to bulk delete"));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Purge Transactions"
        subtitle="Move transactions within a date range to the bin (auto-deletes after 30 days)."
        icon={<Trash2 size={17} />}
      />
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 mt-4">
        <Field label="From (inclusive)" className="flex-1 min-w-[140px]">
          {(props) => (
            <Input {...props} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <Field label="To (exclusive)" className="flex-1 min-w-[140px]">
          {(props) => (
            <Input {...props} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          )}
        </Field>
        <Button type="submit" variant="danger" disabled={isDeleting || (!from && !to)}>
          {isDeleting ? "Deleting..." : "Delete to Bin"}
        </Button>
      </form>
      {confirming && (
        <div className="mt-4 space-y-3 rounded-2xl bg-expense-soft p-4">
          <p className="text-sm font-medium text-ink">
            Move transactions in this date range to the bin? They're deleted for good after 30 days.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={purge}>
              Move to bin
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <ErrorText>{error}</ErrorText>}
    </Card>
  );
}
