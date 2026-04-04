import { NextRequest, NextResponse } from "next/server";
import { getNormalizedSalesForecastRows } from "@/app/lib/salesForecastCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RESPONSE_CACHE_CONTROL = "private, max-age=20, stale-while-revalidate=120";

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
    const rows = await getNormalizedSalesForecastRows();

    if (!rows.length) {
      return NextResponse.json(
        {
          startDate: "",
          endDate: "",
          labels: [],
          revenue: [],
          quantities: [],
          source: "SalesForecast",
          historyRows: [],
          inventorySnapshot: [],
        },
        { headers: { "Cache-Control": RESPONSE_CACHE_CONTROL } }
      );
    }

    const latestAvailableDate = rows[rows.length - 1].date;
    const earliestAvailableDate = rows[0].date;

    const url = new URL(req.url);
    const requestedEnd = parseIsoInput(url.searchParams.get("end"));
    const requestedStart = parseIsoInput(url.searchParams.get("start"));

    const safeEnd = requestedEnd && requestedEnd <= latestAvailableDate ? requestedEnd : latestAvailableDate;
    const defaultStart = earliestAvailableDate;
    const safeStart = requestedStart
      ? (requestedStart < earliestAvailableDate ? earliestAvailableDate : requestedStart > safeEnd ? defaultStart : requestedStart)
      : defaultStart;

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

    return NextResponse.json(
      {
        startDate: safeStart,
        endDate: safeEnd,
        labels,
        revenue,
        quantities,
        source: "SalesForecast",
        earliestAvailableDate,
        latestAvailableDate,
        historyRows,
        inventorySnapshot,
      },
      { headers: { "Cache-Control": RESPONSE_CACHE_CONTROL } }
    );
  } catch (e: any) {
    console.error("GET /api/analytics/sales-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
