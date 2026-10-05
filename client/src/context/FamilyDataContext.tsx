import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import type { Account, Category, Transaction } from "../api/types";

interface FamilyDataValue {
  accounts: Account[];
  categories: Category[];
  isLoadingStatic: boolean;
  staticError: string | null;
  refreshAccounts: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  /** Cached rows for a calendar year, or undefined if it hasn't been fetched (or was invalidated) yet. */
  getYear: (year: number) => Transaction[] | undefined;
  isYearLoading: (year: number) => boolean;
  /** Returns the year's rows, fetching (and caching) them first if needed. Concurrent calls for the
   * same year share one request. */
  ensureYear: (year: number) => Promise<Transaction[]>;
  /** Drops a year's cache so the next ensureYear re-fetches it — call after a transaction is added,
   * edited or deleted. */
  invalidateYear: (year: number) => void;
  /** Drops every cached year — call after something changes transactions wholesale (e.g. a reset). */
  invalidateAll: () => void;
}

const FamilyDataContext = createContext<FamilyDataValue | null>(null);

const REVALIDATE_ON_FOCUS_MS = 15_000;
const REVALIDATE_INTERVAL_MS = 2 * 60_000;

/**
 * One calendar year of transactions, by local time: a year's views filter by local dates, and with
 * UTC bounds an entry made just after midnight on 1 January east of UTC (before 05:30 in India) was
 * cached with the previous year and missing from January.
 */
async function fetchYear(familyId: string, year: number) {
  const res = await api.get<Transaction[]>(`/families/${familyId}/transactions`, {
    params: {
      from: new Date(year, 0, 1).toISOString(),
      to: new Date(year + 1, 0, 1).toISOString(),
      limit: 5000,
    },
  });
  return res.data;
}

/**
 * Fetches accounts, categories and transactions (cached a calendar year at a time) once per family
 * and shares them across every page — the Transactions hub's sub-views, Dashboard and Insights all
 * read from here instead of each re-fetching on every mount or view switch. Lives in Layout, which
 * (unlike the routed pages under it) never remounts on navigation, so the cache survives tab switches.
 */
export function FamilyDataProvider({ familyId, children }: { familyId: string; children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingStatic, setIsLoadingStatic] = useState(true);
  const [staticError, setStaticError] = useState<string | null>(null);
  const [years, setYears] = useState<Record<number, Transaction[]>>({});
  const [loadingYears, setLoadingYears] = useState<Record<number, boolean>>({});
  const inFlight = useRef<Map<number, Promise<Transaction[]>>>(new Map());
  // Bumped when the family changes, so a response for the previous family can't land in this cache.
  const generation = useRef(0);
  const yearsRef = useRef(years);
  yearsRef.current = years;

  const refreshAccounts = useCallback(async () => {
    const res = await api.get<Account[]>(`/families/${familyId}/accounts`);
    setAccounts(res.data);
  }, [familyId]);

  const refreshCategories = useCallback(async () => {
    const res = await api.get<Category[]>(`/families/${familyId}/categories`);
    setCategories(res.data);
  }, [familyId]);

  // Everything is scoped to the current family — a fresh cache whenever it changes.
  useEffect(() => {
    let cancelled = false;
    setIsLoadingStatic(true);
    setStaticError(null);
    setYears({});
    inFlight.current.clear();
    generation.current++;
    Promise.all([refreshAccounts(), refreshCategories()])
      .catch((err) => {
        if (!cancelled) setStaticError(getErrorMessage(err, "Unable to load accounts or categories"));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStatic(false);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId, refreshAccounts, refreshCategories]);

  const getYear = useCallback((year: number) => years[year], [years]);
  const isYearLoading = useCallback((year: number) => Boolean(loadingYears[year]), [loadingYears]);

  const invalidateYear = useCallback((year: number) => {
    inFlight.current.delete(year);
    setYears((prev) => {
      if (!(year in prev)) return prev;
      const next = { ...prev };
      delete next[year];
      return next;
    });
  }, []);

  const invalidateAll = useCallback(() => {
    inFlight.current.clear();
    setYears({});
  }, []);

  const ensureYear = useCallback(
    (year: number) => {
      const cached = years[year];
      if (cached) return Promise.resolve(cached);
      const existing = inFlight.current.get(year);
      if (existing) return existing;

      setLoadingYears((prev) => ({ ...prev, [year]: true }));
      const startGeneration = generation.current;
      const promise = fetchYear(familyId, year)
        .then((rows) => {
          if (generation.current === startGeneration) setYears((prev) => ({ ...prev, [year]: rows }));
          return rows;
        })
        .finally(() => {
          inFlight.current.delete(year);
          setLoadingYears((prev) => {
            const next = { ...prev };
            delete next[year];
            return next;
          });
        });
      inFlight.current.set(year, promise);
      return promise;
    },
    [familyId, years]
  );

  // Changes made on another device (the phone app, SMS imports, another member) arrive here without
  // a reload: whenever the tab comes back into view, and every couple of minutes while it's open.
  // Cached years are refetched in place, so nothing on screen blanks out while that happens.
  const lastRevalidated = useRef(Date.now());
  const revalidate = useCallback(async () => {
    lastRevalidated.current = Date.now();
    const startGeneration = generation.current;
    const cachedYears = Object.keys(yearsRef.current).map(Number);
    await Promise.all([
      refreshAccounts().catch(() => undefined),
      ...cachedYears.map((year) =>
        fetchYear(familyId, year)
          .then((rows) => {
            if (generation.current === startGeneration && !inFlight.current.has(year)) setYears((prev) => (year in prev ? { ...prev, [year]: rows } : prev));
          })
          .catch(() => undefined)
      ),
    ]);
  }, [familyId, refreshAccounts]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRevalidated.current > REVALIDATE_ON_FOCUS_MS) revalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") revalidate();
    }, REVALIDATE_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [revalidate]);

  const value: FamilyDataValue = {
    accounts,
    categories,
    isLoadingStatic,
    staticError,
    refreshAccounts,
    refreshCategories,
    getYear,
    isYearLoading,
    ensureYear,
    invalidateYear,
    invalidateAll,
  };

  return <FamilyDataContext.Provider value={value}>{children}</FamilyDataContext.Provider>;
}

export function useFamilyData() {
  const ctx = useContext(FamilyDataContext);
  if (!ctx) throw new Error("useFamilyData must be used within a FamilyDataProvider");
  return ctx;
}

/** Cached transactions for one calendar year, fetching them the first time this year is asked for. */
export function useYearTransactions(year: number) {
  const { getYear, ensureYear, isYearLoading } = useFamilyData();
  useEffect(() => {
    ensureYear(year).catch(() => undefined);
  }, [year, ensureYear]);
  return { data: getYear(year) ?? [], isLoading: isYearLoading(year) && !getYear(year) };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last `days` of transactions, newest first, read from the per-year cache (so it spans into last
 * year in January without a separate fetch). What payee suggestions and the uncategorised review use.
 */
export function useRecentHistory(days = 365) {
  const [since] = useState(() => new Date(Date.now() - days * DAY_MS));
  const thisYear = new Date().getFullYear();
  const current = useYearTransactions(thisYear);
  const previous = useYearTransactions(since.getFullYear());
  const data = useMemo(() => {
    const rows = since.getFullYear() === thisYear ? current.data : [...current.data, ...previous.data];
    const from = since.toISOString();
    return rows.filter((t) => t.date >= from).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [current.data, previous.data, since, thisYear]);
  return { data, isLoading: current.isLoading || previous.isLoading };
}
