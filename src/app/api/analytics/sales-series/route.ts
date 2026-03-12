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

function parseIsoInput(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
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

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
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
    const { data: rawRows, error } = await supabase
      .from("SalesForecast")
      .select("Date,Product_ID,Product_Name,Category,Selling_Price,Beginning_Stock,Units_Sold,Revenue,Ending_Stock")
      .limit(100000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
          beginningStock: Math.max(0, Number(row.Beginning_Stock || 0)),
          unitsSold: Math.max(0, Number(row.Units_Sold || 0)),
          revenue: Math.max(0, Number(row.Revenue || 0)),
          endingStock: Math.max(0, Number(row.Ending_Stock || 0)),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((left, right) => left.date.localeCompare(right.date));

    if (!rows.length) {
      return NextResponse.json({
        startDate: "",
        endDate: "",
        labels: [],
        revenue: [],
        quantities: [],
        source: "SalesForecast",
        historyRows: [],
        inventorySnapshot: [],
      });
    }

    const latestAvailableDate = rows[rows.length - 1].date;
    const earliestAvailableDate = rows[0].date;

    const url = new URL(req.url);
    const requestedEnd = parseIsoInput(url.searchParams.get("end"));
    const requestedStart = parseIsoInput(url.searchParams.get("start"));

    const safeEnd = requestedEnd && requestedEnd <= latestAvailableDate ? requestedEnd : latestAvailableDate;
    const defaultStart = addDaysISO(safeEnd, -1094);
    const safeStart = requestedStart
      ? (requestedStart < earliestAvailableDate ? earliestAvailableDate : requestedStart > safeEnd ? defaultStart : requestedStart)
      : (defaultStart < earliestAvailableDate ? earliestAvailableDate : defaultStart);

    const labels = enumerateDates(safeStart, safeEnd);
    const revenueByDay: Record<string, number> = {};
    const unitsByDay: Record<string, number> = {};
    const historyRows = rows
      .filter((row) => row.date >= safeStart && row.date <= safeEnd)
      .sort((left, right) => right.date.localeCompare(left.date));

    for (const row of historyRows) {
      revenueByDay[row.date] = (revenueByDay[row.date] || 0) + row.revenue;
      unitsByDay[row.date] = (unitsByDay[row.date] || 0) + row.unitsSold;
    }

    const revenue = labels.map((dayIso) => revenueByDay[dayIso] || 0);
    const quantities = labels.map((dayIso) => unitsByDay[dayIso] || 0);

    const inventorySnapshot = rows
      .filter((row) => row.date === latestAvailableDate)
      .map((row) => ({
        date: row.date,
        productId: row.productId,
        productName: row.productName,
        category: row.category,
        currentStock: row.endingStock,
        unitsSold: row.unitsSold,
        revenue: row.revenue,
        sellingPrice: row.sellingPrice,
      }))
      .sort((left, right) => right.currentStock - left.currentStock);

    return NextResponse.json({
      startDate: safeStart,
      endDate: safeEnd,
      labels,
      revenue,
      quantities,
      source: "SalesForecast",
      latestAvailableDate,
      historyRows,
      inventorySnapshot,
    });
  } catch (e: any) {
    console.error("GET /api/analytics/sales-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
