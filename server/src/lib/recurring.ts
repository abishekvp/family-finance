import { RecurringFrequency } from "@prisma/client";

/**
 * Repeating payments are scheduled on calendar days, not instants: a `@db.Date` column reads back as
 * UTC midnight of that day, and all the arithmetic here stays in UTC so a day never shifts. The
 * caller's time zone only matters when deciding what "today" is and when stamping the transaction.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Occurrence number `index` (0 = the first) of a schedule starting on `start`. */
export function occurrence(start: Date, frequency: RecurringFrequency, index: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  if (frequency === RecurringFrequency.WEEKLY) return new Date(Date.UTC(y, m, d + 7 * index));
  // Monthly and yearly keep the start's day of the month, clamped for shorter months (31st → 30th).
  const months = frequency === RecurringFrequency.MONTHLY ? index : 12 * index;
  const firstOfTarget = new Date(Date.UTC(y, m + months, 1));
  const ty = firstOfTarget.getUTCFullYear();
  const tm = firstOfTarget.getUTCMonth();
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, lastDay)));
}

/** The caller's local calendar day, as UTC midnight. `tzOffset` is JavaScript's getTimezoneOffset(). */
export function localToday(tzOffset: number, now = Date.now()): Date {
  const local = new Date(now - tzOffset * 60 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** When a scheduled day's transaction is dated: 9 AM on that day in the caller's time zone. */
export function postingInstant(day: Date, tzOffset: number): Date {
  return new Date(day.getTime() + 9 * 60 * 60 * 1000 + tzOffset * 60 * 1000);
}

/** A "YYYY-MM-DD" day as UTC midnight, or null when it isn't one. */
export function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDate() === Number(match[3]) ? date : null;
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Occurrences from number `fromIndex` on that fall in [start, end) and not after `endDate`. Used
 * for "still to come this month/year" in budgets.
 */
export function occurrencesBetween(
  schedule: { startDate: Date; frequency: RecurringFrequency; endDate: Date | null },
  fromIndex: number,
  start: Date,
  end: Date
): Date[] {
  const days: Date[] = [];
  // Skip straight to the window instead of walking years of weekly occurrences one by one.
  let index = fromIndex;
  if (schedule.frequency === RecurringFrequency.WEEKLY) {
    const weeksToStart = Math.floor((start.getTime() - schedule.startDate.getTime()) / (7 * DAY_MS));
    index = Math.max(index, weeksToStart - 1);
  }
  for (let guard = 0; guard < 400; guard++, index++) {
    const day = occurrence(schedule.startDate, schedule.frequency, index);
    if (day >= end || (schedule.endDate && day > schedule.endDate)) break;
    if (day >= start) days.push(day);
  }
  return days;
}
