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
  onCacheHit?: (res: { data: T }) => void
): Promise<{ data: T }> {
  const file = getCacheFile(url, config?.params);

  if (file.exists && onCacheHit) {
    try {
      const cached = JSON.parse(file.textSync());
      onCacheHit({ data: cached as T });
    } catch (e) {
      // ignore cache read errors
    }
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
