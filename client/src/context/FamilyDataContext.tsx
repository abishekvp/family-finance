import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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
      const promise = api
        .get<Transaction[]>(`/families/${familyId}/transactions`, {
          params: {
            from: new Date(Date.UTC(year, 0, 1)).toISOString(),
            to: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
            limit: 5000,
          },
        })
        .then((res) => {
          setYears((prev) => ({ ...prev, [year]: res.data }));
          return res.data;
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
