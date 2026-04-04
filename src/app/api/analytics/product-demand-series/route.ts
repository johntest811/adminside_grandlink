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

    const rows = (await getNormalizedSalesForecastRows())
      .filter((row) => !category || row.category.toLowerCase() === category)
      .sort((left, right) => left.date.localeCompare(right.date));

    if (!rows.length) {
      return NextResponse.json(
        {
          startDate: "",
          endDate: "",
          labels: [],
          products: [],
          source: "SalesForecast",
          inventorySnapshot: [],
        },
        { headers: { "Cache-Control": RESPONSE_CACHE_CONTROL } }
      );
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

    return NextResponse.json(
      {
        startDate,
        endDate,
        labels,
        products,
        source: "SalesForecast",
        latestAvailableDate,
        inventorySnapshot,
      },
      { headers: { "Cache-Control": RESPONSE_CACHE_CONTROL } }
    );
  } catch (e: any) {
    console.error("GET /api/analytics/product-demand-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
