import { addMonths, startOfMonth } from "date-fns";

/** [from, to) range covering the calendar month containing `date`. `to` is an exclusive bound. */
export function monthRange(date: Date): { from: Date; to: Date } {
  const from = startOfMonth(date);
  return { from, to: addMonths(from, 1) };
}

/** [from, to) range covering a calendar year. `to` is an exclusive bound. */
export function yearRange(year: number): { from: Date; to: Date } {
  return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) };
}

export function toIsoDateTime(date: Date): string {
  return date.toISOString();
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

/** The local calendar day of `date` as YYYY-MM-DD (not the UTC day toISOString() would give). */
export function localDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
