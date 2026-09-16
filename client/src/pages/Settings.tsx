import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import { Button, Card, ErrorText, Input, Label } from "../components/ui";
import type { LayoutContext } from "../components/Layout";
import { loadPrefs, savePrefs, type LandingView, type Prefs, type WeekStart } from "../lib/prefs";
import { CategoryManager } from "../components/settings/CategoryManager";
import { BudgetManager } from "../components/settings/BudgetManager";

const LANDING_VIEW_OPTIONS: LandingView[] = ["Daily", "Calendar"];
const WEEK_START_OPTIONS: WeekStart[] = ["Sunday", "Monday"];

export function Settings() {
  const { family } = useOutletContext<LayoutContext>();
  const isAdmin = family.role === "ADMIN";

  const [currency, setCurrency] = useState(family.currency);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [currencySuccess, setCurrencySuccess] = useState(false);
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
    setCurrencySuccess(false);
    setIsSavingCurrency(true);
    try {
      await api.patch(`/families/${family.id}`, { currency: currency.toUpperCase() });
      setCurrencySuccess(true);
    } catch (err) {
      setCurrencyError(getErrorMessage(err, "Unable to update currency"));
    } finally {
      setIsSavingCurrency(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <h2 className="mb-4 text-lg font-semibold">Currency</h2>
        {isAdmin ? (
          <form onSubmit={handleCurrencySubmit} className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="family-currency">Family currency (ISO code)</Label>
              <Input
                id="family-currency"
                required
                maxLength={3}
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value.toUpperCase());
                  setCurrencySuccess(false);
                }}
                className="w-24 uppercase"
              />
            </div>
            <Button type="submit" disabled={isSavingCurrency}>
              {isSavingCurrency ? "Saving..." : "Save"}
            </Button>
            {currencySuccess && <p className="text-sm text-income">Saved.</p>}
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            Current currency: <span className="font-medium">{family.currency}</span>. Only an admin can change it.
          </p>
        )}
        <ErrorText>{currencyError}</ErrorText>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Transactions preferences</h2>

        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Default landing view</p>
        <div className="mb-4 flex gap-4">
          {LANDING_VIEW_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="default-view"
                checked={prefs.defaultView === option}
                onChange={() => updatePrefs({ defaultView: option })}
                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
              />
              {option}
            </label>
          ))}
        </div>

        <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">Week starts on</p>
        <div className="mb-4 flex gap-4">
          {WEEK_START_OPTIONS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="radio"
                name="week-start"
                checked={prefs.weekStart === option}
                onChange={() => updatePrefs({ weekStart: option })}
                className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
              />
              {option}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs.carryOver}
            onChange={(e) => updatePrefs({ carryOver: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600"
          />
          <span>
            <span className="font-medium text-slate-700 dark:text-slate-300">Carry-over balances</span>
            <span className="block text-xs text-slate-400 dark:text-slate-500">
              Show a running balance instead of a blank state for periods with no transactions.
            </span>
          </span>
        </label>
      </Card>

      <CategoryManager familyId={family.id} />
      <BudgetManager familyId={family.id} currency={family.currency} />
    </div>
  );
}
