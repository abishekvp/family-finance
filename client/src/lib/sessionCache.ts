import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

/**
 * A per-tab cache in sessionStorage: pages paint from it straight away on a reload or a revisit, and
 * the network copy replaces it as soon as it arrives (stale-while-revalidate). It lives only as long as
 * the tab, and is wiped on sign-out.
 *
 * Decrypted payees and notes are never written here for a family that uses end-to-end encryption —
 * the vault key is gone after a reload, and its plaintext must go with it (see `sensitive`).
 */

const PREFIX = "ffc:v1:";
// sessionStorage holds ~5MB per origin; one entry past this is skipped rather than evicting others.
const MAX_ENTRY_CHARS = 1_500_000;

interface Entry<T> {
  at: number;
  data: T;
}

export function readCache<T>(key: string): Entry<T> | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Entry<T>) : null;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T) {
  try {
    const raw = JSON.stringify({ at: Date.now(), data } satisfies Entry<T>);
    if (raw.length > MAX_ENTRY_CHARS) {
      sessionStorage.removeItem(PREFIX + key);
      return;
    }
    sessionStorage.setItem(PREFIX + key, raw);
  } catch {
    // Quota or storage disabled: the app still works, just without the head start.
  }
}

export function dropCache(match: (key: string) => boolean) {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX) && match(key.slice(PREFIX.length))) sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore.
  }
}

/** Everything cached for every family — on sign-out. */
export function clearSessionCache() {
  dropCache(() => true);
}

/** A stable cache key for a request. */
export function cacheKey(url: string, params?: Record<string, unknown>) {
  if (!params) return url;
  const query = Object.keys(params)
    .filter((k) => params[k] !== undefined && k !== "tzOffset")
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  return query ? `${url}?${query}` : url;
}

/**
 * GETs `url`, showing the cached copy first. `reload` refetches (after a change); `version` bumps on
 * every arrival. Pass `sensitive` for data carrying encrypted fields so it's only cached in memory.
 */
export function useCachedGet<T>(
  url: string | null,
  params?: Record<string, unknown>,
  { sensitive = false, fallback }: { sensitive?: boolean; fallback?: T } = {}
) {
  const key = url ? cacheKey(url, params) : null;
  const [data, setData] = useState<T | undefined>(() => (key && !sensitive ? readCache<T>(key)?.data : undefined) ?? fallback);
  const [isLoading, setIsLoading] = useState(() => !!key && (sensitive || !readCache(key)));
  const [error, setError] = useState<unknown>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async () => {
    if (!url || !key) return;
    try {
      const res = await api.get<T>(url, { params: paramsRef.current });
      setData(res.data);
      setError(null);
      if (!sensitive) writeCache(key, res.data);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [url, key, sensitive]);

  useEffect(() => {
    if (!key) return;
    const cached = sensitive ? null : readCache<T>(key);
    if (cached) {
      setData(cached.data);
      setIsLoading(false);
    } else {
      // A different request with nothing cached: don't keep showing the previous one's rows.
      setData(fallback);
      setIsLoading(true);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sensitive, load]);

  return { data: data ?? fallback, isLoading, error, reload: load, setData };
}
