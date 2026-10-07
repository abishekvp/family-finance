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

/** The local time of day of `date` as HH:mm (24-hour), what an <input type="time"> holds. */
export function localTimeInput(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** A YYYY-MM-DD day at an HH:mm time, as that local moment; null when either isn't valid. */
export function combineDateTime(day: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.trim()) || !/^\d{1,2}:\d{2}$/.test(time.trim())) return null;
  const [hours, minutes] = time.trim().split(":").map(Number);
  if (hours > 23 || minutes > 59) return null;
  const at = new Date(`${day.trim()}T00:00:00`);
  if (Number.isNaN(at.getTime())) return null;
  at.setHours(hours, minutes, 0, 0);
  return at;
}

/** A transaction's time of day in the browser's own format, e.g. "10:42 AM" or "10:42". */
export function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
