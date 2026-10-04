import { Directory, File, Paths } from "expo-file-system";
import { api } from "../api/client";

function getCacheFile(url: string, params?: any) {
  const query = params ? JSON.stringify(params) : "";
  const safeName = encodeURIComponent(url + query).replace(/%/g, "_") + ".json";
  const dir = new Directory(Paths.document, "api-cache");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return new File(dir, safeName);
}

export async function fetchWithCache<T>(
  url: string,
  config?: any,
  onCacheHit?: (res: { data: T }) => void,
  maxAgeMs?: number
): Promise<{ data: T }> {
  const file = getCacheFile(url, config?.params);
  let isFresh = false;

  if (file.exists && onCacheHit) {
    try {
      const cached = JSON.parse(file.textSync());
      onCacheHit({ data: cached as T });
      if (maxAgeMs !== undefined) {
        const stat = file.getInfo();
        if (stat.exists && stat.modificationTime) {
          const ageMs = Date.now() - (stat.modificationTime * 1000);
          if (ageMs < maxAgeMs) isFresh = true;
        }
      }
    } catch (e) {
      // ignore cache read errors
    }
  }

  if (isFresh) {
    return { data: JSON.parse(file.textSync()) as T };
  }

  const res = await api.get<T>(url, config);
  try {
    if (res.data) {
      if (!file.exists) file.create();
      file.write(JSON.stringify(res.data));
    }
  } catch (e) {
    // ignore cache write errors
  }
  return res;
}
