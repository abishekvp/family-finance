import { addWeeks, endOfMonth, endOfWeek, getISOWeek, startOfMonth, startOfWeek } from "date-fns";
import type { WeekStart } from "./prefs";
import { weekStartsOn } from "./prefs";

export interface WeekBucket {
  key: string;
  weekNumber: number;
  start: Date;
  end: Date;
}

/** Splits the calendar month containing `monthDate` into week buckets aligned to `weekStart`. */
export function weekBucketsForMonth(monthDate: Date, weekStart: WeekStart): WeekBucket[] {
  const wsOn = weekStartsOn(weekStart);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);

  const buckets: WeekBucket[] = [];
  let cursor = startOfWeek(monthStart, { weekStartsOn: wsOn });
  while (cursor <= monthEnd) {
    const end = endOfWeek(cursor, { weekStartsOn: wsOn });
    buckets.push({ key: cursor.toISOString(), weekNumber: getISOWeek(cursor), start: cursor, end });
    cursor = addWeeks(cursor, 1);
  }
  return buckets;
}

export function bucketForDate(date: Date, buckets: WeekBucket[]): WeekBucket | undefined {
  return buckets.find((b) => date >= b.start && date <= b.end);
}
