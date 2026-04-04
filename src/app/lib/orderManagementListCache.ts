type OrderManagementListCacheEntry = {
  payload: any;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 10_000;
const GLOBAL_CACHE_KEY = "__grandlinkOrderManagementListCache";

function getCacheTtlMs() {
  const parsed = Number(process.env.ORDER_MANAGEMENT_LIST_CACHE_TTL_MS || DEFAULT_TTL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MS;
  return Math.max(2_000, Math.floor(parsed));
}

function getCacheMap() {
  const g = globalThis as any;
  if (!g[GLOBAL_CACHE_KEY]) {
    g[GLOBAL_CACHE_KEY] = new Map<string, OrderManagementListCacheEntry>();
  }
  return g[GLOBAL_CACHE_KEY] as Map<string, OrderManagementListCacheEntry>;
}

export function getCachedOrderManagementList(key: string) {
  const entry = getCacheMap().get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    getCacheMap().delete(key);
    return null;
  }
  return entry.payload;
}

export function setCachedOrderManagementList(key: string, payload: any) {
  getCacheMap().set(key, {
    payload,
    expiresAt: Date.now() + getCacheTtlMs(),
  });
}

export function invalidateOrderManagementListCache() {
  getCacheMap().clear();
}
