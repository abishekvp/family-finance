import { addWeeks, endOfWeek, getISOWeek, startOfMonth, startOfWeek } from "date-fns";
import type { WeekStart } from "../context/PrefsContext";
import { weekStartsOn } from "./dateUtils";

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
  const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);

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
