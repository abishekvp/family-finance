import type { WeekStart } from "../context/PrefsContext";

/** [from, to) range covering the calendar month containing `date`. `to` is an exclusive bound. */
export function monthRange(date: Date): { from: Date; to: Date } {
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return { from, to };
}

/** [from, to) range covering a calendar year. `to` is an exclusive bound. */
export function yearRange(year: number): { from: Date; to: Date } {
  return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) };
}

export const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** date-fns `weekStartsOn` value (0 = Sunday, 1 = Monday) for the app's local week-start pref. */
export function weekStartsOn(weekStart: WeekStart): 0 | 1 {
  return weekStart === "monday" ? 1 : 0;
}

/**
 * The local calendar day of `date` as YYYY-MM-DD. Not `toISOString().slice(0, 10)`: that is the
 * UTC day, which east of UTC is yesterday for the first hours of every day.
 */
export function localDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isSameDayIso(a: string, b: Date): boolean {
  const d = new Date(a);
  return d.getFullYear() === b.getFullYear() && d.getMonth() === b.getMonth() && d.getDate() === b.getDate();
}
