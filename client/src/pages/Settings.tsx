import { useEffect, useState, type FormEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { CalendarCog, Coins, Inbox, Smartphone, Trash2, Wand2 } from "lucide-react";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import { Button, Card, CardHeader, Chip, ErrorText, Field, Input, Modal, Radio, Toggle, useToast } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useFamilyData } from "../context/FamilyDataContext";
import type { LayoutContext } from "../components/Layout";
import { loadPrefs, savePrefs, type LandingView, type Prefs, type WeekStart } from "../lib/prefs";
import { BulkDeleteCard } from "../components/settings/BulkDeleteCard";
import { BinManager } from "../components/settings/BinManager";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

const LANDING_VIEW_OPTIONS: LandingView[] = ["Daily", "Calendar"];
const WEEK_START_OPTIONS: WeekStart[] = ["Sunday", "Monday"];

/** Admin-only: clears every transaction and zeroes all balances, keeping accounts and categories. */
function ResetDataCard({ familyId }: { familyId: string }) {
  const toast = useToast();
  const { invalidateAll, refreshAccounts } = useFamilyData();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  async function reset() {
    setError(null);
    setIsResetting(true);
    try {
      const res = await api.post<{ transactionsCleared: number }>(`/families/${familyId}/transactions/reset`, { confirm: true });
      invalidateAll();
      await refreshAccounts();
      toast(`Cleared ${res.data.transactionsCleared} transactions and reset balances`);
      close();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to clear transactions"));
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Clear transactions & balances"
        subtitle="Start fresh. Accounts and categories stay."
        icon={<Trash2 size={17} />}
        actions={
          <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
            Clear…
          </Button>
        }
      />
      {open && (
        <Modal
          title="Clear all transactions?"
          description="Every transaction is deleted and every account balance goes back to zero. Accounts, categories, budgets and goals are kept. This can't be undone."
          onClose={close}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button variant="danger" loading={isResetting} disabled={typed.trim().toUpperCase() !== "CLEAR"} onClick={reset}>
                Clear everything
              </Button>
            </div>
          }
        >
          <Field label="Type CLEAR to confirm">
            {(props) => <Input {...props} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
          </Field>
          <ErrorText>{error}</ErrorText>
        </Modal>
      )}
    </Card>
  );
}

export function Settings() {
  const { family } = useOutletContext<LayoutContext>();
  const isAdmin = family.role === "ADMIN";
  const toast = useToast();
  const { refreshUser } = useAuth();

  const [currency, setCurrency] = useState(family.currency);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [isSavingCurrency, setIsSavingCurrency] = useState(false);

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  useEffect(() => {
    setCurrency(family.currency);
  }, [family.currency]);

  function updatePrefs(patch: Partial<Prefs>) {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      savePrefs(next);
      return next;
    });
  }

  async function saveCurrency(value: string) {
    const code = value.trim().toUpperCase();
    if (code.length !== 3) {
      setCurrencyError("Enter a 3-letter currency code, e.g. USD");
      return;
    }
    setCurrencyError(null);
    setIsSavingCurrency(true);
    try {
      await api.patch(`/families/${family.id}`, { currency: code });
      setCurrency(code);
      await refreshUser();
      toast("Currency updated");
    } catch (err) {
      setCurrencyError(getErrorMessage(err, "Unable to update currency"));
    } finally {
      setIsSavingCurrency(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <CardHeader title="Currency" icon={<Coins size={17} />} />
        {isAdmin ? (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              saveCurrency(currency);
            }}
            className="space-y-4"
          >
            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((c) => (
                <Chip key={c} selected={family.currency === c} disabled={isSavingCurrency} onClick={() => saveCurrency(c)}>
                  {c}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
            <Field label="Other currency (ISO code)" className="w-40">
              {(props) => (
                <Input
                  {...props}
                  required
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  className="uppercase"
                />
              )}
            </Field>
            <Button type="submit" variant="secondary" loading={isSavingCurrency} disabled={currency.trim().length !== 3 || currency.trim().toUpperCase() === family.currency}>
              Save
            </Button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-ink-muted">
            Current currency: <span className="font-semibold text-ink">{family.currency}</span>. Only an admin can
            change it.
          </p>
        )}
        <ErrorText>{currencyError}</ErrorText>
      </Card>

      <Card>
        <CardHeader title="Transaction preferences" icon={<CalendarCog size={17} />} />

        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-ink">Default landing view</p>
            <div className="flex gap-5">
              {LANDING_VIEW_OPTIONS.map((option) => (
                <Radio
                  key={option}
                  name="default-view"
                  checked={prefs.defaultView === option}
                  onChange={() => updatePrefs({ defaultView: option })}
                  label={option}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Week starts on</p>
            <div className="flex gap-5">
              {WEEK_START_OPTIONS.map((option) => (
                <Radio
                  key={option}
                  name="week-start"
                  checked={prefs.weekStart === option}
                  onChange={() => updatePrefs({ weekStart: option })}
                  label={option}
                />
              ))}
            </div>
          </div>

          <Toggle
            checked={prefs.carryOver}
            onChange={(next) => updatePrefs({ carryOver: next })}
            label="Carry-over balances"
            description="Show a running balance instead of a blank state for periods with no transactions."
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Uncategorised transactions"
          subtitle="Recent expenses and income that still need a category. Payee rules file most of them on their own."
          icon={<Inbox size={17} />}
          className="!mb-0"
          actions={
            <>
              <Link to="/payee-rules">
                <Button variant="ghost" size="sm" icon={<Wand2 size={14} />}>
                  Payee rules
                </Button>
              </Link>
              <Link to="/uncategorized">
                <Button variant="secondary" size="sm">
                  Review uncategorised
                </Button>
              </Link>
            </>
          }
        />
      </Card>

      <BinManager familyId={family.id} />
      {isAdmin && <BulkDeleteCard familyId={family.id} />}
      {isAdmin && <ResetDataCard familyId={family.id} />}

      <Card>
        <CardHeader
          title="Get the app"
          subtitle="Install Family Finance on your phone"
          icon={<Smartphone size={17} />}
          actions={
            <Link to="/get-the-app">
              <Button variant="secondary" size="sm">
                Open
              </Button>
            </Link>
          }
        />
      </Card>
    </div>
  );
}
