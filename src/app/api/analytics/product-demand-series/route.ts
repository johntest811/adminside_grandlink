import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function dateKey(iso: string) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
      !Number.isNaN(parsed.getTime()) &&
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
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
      .select("Date,Product_ID,Product_Name,Category,Selling_Price,Units_Sold,Revenue,Ending_Stock")
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    if (!data?.length) break;
    allRows.push(...data);

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return allRows;
}

function enumerateDates(startISO: string, endISO: string) {
  const out: string[] = [];
  const start = new Date(`${startISO}T00:00:00.000Z`);
  const end = new Date(`${endISO}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(dateKey(d.toISOString()));
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const daysParam = url.searchParams.get("days");
    const parsedDays = Number(daysParam || 0);
    const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.max(90, Math.min(3650, parsedDays)) : null;
    const limit = Math.max(3, Math.min(50, Number(url.searchParams.get("limit") || 12)));
    const category = (url.searchParams.get("category") || "").trim().toLowerCase();

    const rawRows = await fetchAllSalesForecastRows();

    const rows = (rawRows || [])
      .map((row: any) => {
        const date = parseSalesForecastDate(row.Date);
        if (!date) return null;
        return {
          date,
          productId: String(row.Product_ID || ""),
          productName: String(row.Product_Name || row.Product_ID || "Unknown Product"),
          category: String(row.Category || "Uncategorized"),
          sellingPrice: Math.max(0, Number(row.Selling_Price || 0)),
          unitsSold: Math.max(0, Number(row.Units_Sold || 0)),
          revenue: Math.max(0, Number(row.Revenue || 0)),
          endingStock: Math.max(0, Number(row.Ending_Stock || 0)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => !category || row.category.toLowerCase() === category)
      .sort((left, right) => left.date.localeCompare(right.date));

    if (!rows.length) {
      return NextResponse.json({
        startDate: "",
        endDate: "",
        labels: [],
        products: [],
        source: "SalesForecast",
        inventorySnapshot: [],
      });
    }

    const latestAvailableDate = rows[rows.length - 1].date;
    const earliestAvailableDate = rows[0].date;
    const defaultStart = days ? addDaysISO(latestAvailableDate, -(days - 1)) : earliestAvailableDate;
    const startDate = defaultStart < earliestAvailableDate ? earliestAvailableDate : defaultStart;
    const endDate = latestAvailableDate;
    const labels = enumerateDates(startDate, endDate);

    const qtyByProductDay: Record<string, Record<string, number>> = {};
    const totalByProduct: Record<string, number> = {};
    const nameByProduct: Record<string, string> = {};
    const inventoryByProduct: Record<string, { date: string; currentStock: number; unitsSold: number; revenue: number; sellingPrice: number; category: string; productName: string }> = {};

    for (const row of rows) {
      const pid = row.productId;
      if (!pid) continue;
      if (row.date < startDate || row.date > endDate) continue;

      if (!qtyByProductDay[pid]) qtyByProductDay[pid] = {};
      qtyByProductDay[pid][row.date] = (qtyByProductDay[pid][row.date] || 0) + row.unitsSold;
      totalByProduct[pid] = (totalByProduct[pid] || 0) + row.unitsSold;
      nameByProduct[pid] = row.productName;
    }

    for (const row of rows) {
      if (row.date !== latestAvailableDate) continue;
      inventoryByProduct[row.productId] = {
        date: row.date,
        currentStock: row.endingStock,
        unitsSold: row.unitsSold,
        revenue: row.revenue,
        sellingPrice: row.sellingPrice,
        category: row.category,
        productName: row.productName,
      };
    }

    const topProductIds = Object.entries(totalByProduct)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, limit)
      .map(([pid]) => pid);

    const products = topProductIds.map((pid) => {
      const byDay = qtyByProductDay[pid] || {};
      return {
        product_id: pid,
        product_name: nameByProduct[pid] || pid,
        labels,
        quantities: labels.map((d) => byDay[d] || 0),
        total_units: totalByProduct[pid] || 0,
      };
    });

    const inventorySnapshot = Object.entries(inventoryByProduct)
      .map(([productId, value]) => ({
        date: value.date,
        productId,
        productName: value.productName,
        category: value.category,
        currentStock: value.currentStock,
        unitsSold: value.unitsSold,
        revenue: value.revenue,
        sellingPrice: value.sellingPrice,
      }))
      .sort((left, right) => right.currentStock - left.currentStock);

    return NextResponse.json({
      startDate,
      endDate,
      labels,
      products,
      source: "SalesForecast",
      latestAvailableDate,
      inventorySnapshot,
    });
  } catch (e: any) {
    console.error("GET /api/analytics/product-demand-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
