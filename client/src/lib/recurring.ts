import { api } from "../api/client";
import type { RecurringFrequency, RecurringTransaction } from "../api/types";

/**
 * Repeating payments (a salary, rent, subscriptions), shared with the mobile app's src/lib/recurring.ts.
 * The server keeps the schedules; each occurrence becomes a real transaction when an app runs them
 * after its day has come, so it counts in balances and in the monthly budget (yearly ones in the yearly).
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

/** Records every repeating payment whose day has come, dated in this browser's time zone. Never throws. */
export async function runRecurring(familyId: string): Promise<number> {
  try {
    const res = await api.post<{ posted: number }>(`/families/${familyId}/recurring/run`, { tzOffset: new Date().getTimezoneOffset() });
    return res.data.posted;
  } catch {
    return 0;
  }
}
