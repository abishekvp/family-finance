import { useEffect, useState, type FormEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { CalendarCog, Coins, Smartphone } from "lucide-react";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import { Button, Card, CardHeader, ErrorText, Field, Input, Radio, Toggle, useToast } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import { loadPrefs, savePrefs, type LandingView, type Prefs, type WeekStart } from "../lib/prefs";
import { CategoryManager } from "../components/settings/CategoryManager";
import { BudgetManager } from "../components/settings/BudgetManager";

const LANDING_VIEW_OPTIONS: LandingView[] = ["Daily", "Calendar"];
const WEEK_START_OPTIONS: WeekStart[] = ["Sunday", "Monday"];

export function Settings() {
  const { family } = useOutletContext<LayoutContext>();
  const isAdmin = family.role === "ADMIN";
  const toast = useToast();

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

  async function handleCurrencySubmit(e: FormEvent) {
    e.preventDefault();
    setCurrencyError(null);
    setIsSavingCurrency(true);
    try {
      await api.patch(`/families/${family.id}`, { currency: currency.toUpperCase() });
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
          <form onSubmit={handleCurrencySubmit} className="flex flex-wrap items-end gap-3">
            <Field label="Family currency (ISO code)" className="w-28">
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
            <Button type="submit" loading={isSavingCurrency}>
              Save
            </Button>
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

      <CategoryManager familyId={family.id} />
      <BudgetManager familyId={family.id} currency={family.currency} />

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
