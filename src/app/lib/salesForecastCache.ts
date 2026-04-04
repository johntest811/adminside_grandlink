import { createClient } from "@supabase/supabase-js";

export type SalesForecastNormalizedRow = {
  date: string;
  productId: string;
  productName: string;
  category: string;
  sellingPrice: number;
  beginningStock: number;
  unitsSold: number;
  revenue: number;
  endingStock: number;
};

type SalesForecastCacheEntry = {
  rows: SalesForecastNormalizedRow[];
  expiresAt: number;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const GLOBAL_CACHE_KEY = "__grandlinkSalesForecastCache";

function getCacheTtlMs() {
  const parsed = Number(process.env.SALES_FORECAST_CACHE_TTL_MS || DEFAULT_TTL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MS;
  return Math.max(10_000, Math.floor(parsed));
}

function excelSerialToIso(serial: number) {
  const base = new Date(Date.UTC(1899, 11, 30));
  base.setUTCDate(base.getUTCDate() + Math.floor(serial));
  return base.toISOString().slice(0, 10);
}

function parseSalesForecastDate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialToIso(value);
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    return excelSerialToIso(Number(text));
  }

  // Handle day-first strings from CSV exports like 31/12/2025.
  const dmyMatch = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const yearRaw = Number(dmyMatch[3]);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      !Number.isNaN(parsed.getTime())
      && parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
    ) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

async function fetchAllSalesForecastRows() {
  const pageSize = 1000;
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("SalesForecast")
      .select("Date,Product_ID,Product_Name,Category,Selling_Price,Beginning_Stock,Units_Sold,Revenue,Ending_Stock")
      .range(from, to);

    if (error) throw new Error(error.message);
    if (!data?.length) break;

    allRows.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function toNormalizedRows(rawRows: any[]): SalesForecastNormalizedRow[] {
  return (rawRows || [])
    .map((row: any) => {
      const date = parseSalesForecastDate(row.Date);
      if (!date) return null;

      return {
        date,
        productId: String(row.Product_ID || ""),
        productName: String(row.Product_Name || row.Product_ID || "Unknown Product"),
        category: String(row.Category || "Uncategorized"),
        sellingPrice: Math.max(0, Number(row.Selling_Price || 0)),
        beginningStock: Math.max(0, Number(row.Beginning_Stock || 0)),
        unitsSold: Math.max(0, Number(row.Units_Sold || 0)),
        revenue: Math.max(0, Number(row.Revenue || 0)),
        endingStock: Math.max(0, Number(row.Ending_Stock || 0)),
      };
    })
    .filter((row): row is SalesForecastNormalizedRow => Boolean(row))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function getCachedRows() {
  const cached = (globalThis as any)[GLOBAL_CACHE_KEY] as SalesForecastCacheEntry | undefined;
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) return null;
  return cached.rows;
}

function setCachedRows(rows: SalesForecastNormalizedRow[]) {
  (globalThis as any)[GLOBAL_CACHE_KEY] = {
    rows,
    expiresAt: Date.now() + getCacheTtlMs(),
  } as SalesForecastCacheEntry;
}

export function invalidateSalesForecastRowsCache() {
  delete (globalThis as any)[GLOBAL_CACHE_KEY];
}

export async function getNormalizedSalesForecastRows() {
  const cached = getCachedRows();
  if (cached) return cached;

  const rawRows = await fetchAllSalesForecastRows();
  const rows = toNormalizedRows(rawRows);
  setCachedRows(rows);
  return rows;
}