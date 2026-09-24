import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { RecurringFrequency, RecurringTransaction } from "../api/types";

/**
 * Repeating payments (a salary, rent, subscriptions). The server keeps the schedules; each
 * occurrence becomes a real transaction when the app runs them after its day has come, so it counts
 * in balances and in the monthly budget (yearly ones in the yearly budget).
 */

export const FREQUENCIES: { value: RecurringFrequency; label: string }[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "WEEKLY", label: "Weekly" },
];

/** A "YYYY-MM-DD" calendar day as a local Date (midnight), for display. */
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDayShort(day: string): string {
  const date = dayToDate(day);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
}

function ordinal(n: number) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** "Monthly on the 5th", "Every Thursday", "Every year on 10 Sep". */
export function describeSchedule(rule: Pick<RecurringTransaction, "frequency" | "startDate">): string {
  const start = dayToDate(rule.startDate);
  if (rule.frequency === "WEEKLY") return `Every ${start.toLocaleDateString(undefined, { weekday: "long" })}`;
  if (rule.frequency === "MONTHLY") return `Monthly on the ${ordinal(start.getDate())}`;
  return `Every year on ${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/** What a schedule comes to per month, for totals (a weekly one is 52 payments a year). */
export function perMonth(rule: Pick<RecurringTransaction, "frequency" | "amount">): number {
  if (rule.frequency === "WEEKLY") return (rule.amount * 52) / 12;
  if (rule.frequency === "YEARLY") return rule.amount / 12;
  return rule.amount;
}

// ---- recording due payments ----------------------------------------------------------------

// Launch always runs; returning to the app runs at most this often.
const MIN_INTERVAL_MS = 60 * 1000;

let lastRunAt = 0;
let inFlight: Promise<number> | null = null;
let version = 0;
const listeners = new Set<(v: number) => void>();

/**
 * Asks the server to record every repeating payment whose day has come, dated on its own day in
 * this phone's time zone. Resolves to how many were recorded; never throws.
 */
export function runRecurring(familyId: string, { force = false }: { force?: boolean } = {}): Promise<number> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return Promise.resolve(0);
  lastRunAt = Date.now();
  inFlight = api
    .post<{ posted: number }>(`/families/${familyId}/recurring/run`, { tzOffset: new Date().getTimezoneOffset() })
    .then((res) => {
      if (res.data.posted > 0) {
        version += 1;
        listeners.forEach((listener) => listener(version));
      }
      return res.data.posted;
    })
    .catch(() => 0)
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Bumps whenever a run records something, so transaction lists can refetch. */
export function useRecurringVersion() {
  const [current, setCurrent] = useState(version);
  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
