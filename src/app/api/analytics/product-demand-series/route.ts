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

function enumerateDates(startISO: string, endISO: string) {
  const out: string[] = [];
  const start = new Date(`${startISO}T00:00:00.000Z`);
  const end = new Date(`${endISO}T00:00:00.000Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(dateKey(d.toISOString()));
  }
  return out;
}

function monthStartISO(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function daysInMonthFromMonthStart(monthStart: string) {
  const d = new Date(`${monthStart}T00:00:00.000Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = 1095;
    const limit = Math.max(3, Math.min(50, Number(url.searchParams.get("limit") || 12)));
    const branch = (url.searchParams.get("branch") || "").trim();

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);

    const startDate = dateKey(start.toISOString());
    const endDate = dateKey(end.toISOString());
    const startMonth = monthStartISO(startDate);
    const endMonth = monthStartISO(endDate);

    const labels = enumerateDates(startDate, endDate);

    let query = supabase
      .from("sales_inventory_data")
      .select("product_id,month_start,branch,units_sold")
      .gte("month_start", startMonth)
      .lte("month_start", endMonth)
      .limit(100000);

    if (branch) query = query.eq("branch", branch);

    const { data: monthlyRows, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // daily qty per product
    const qtyByProductDay: Record<string, Record<string, number>> = {};
    const totalByProduct: Record<string, number> = {};

    for (const row of monthlyRows as any[] || []) {
      const pid = row.product_id;
      if (!pid) continue;
      const month = String(row.month_start || "").slice(0, 10);
      if (!month) continue;
      const monthlyQty = Math.max(0, Number(row.units_sold || 0));
      const dim = daysInMonthFromMonthStart(month);
      const dailyQty = monthlyQty / Math.max(1, dim);

      if (!qtyByProductDay[pid]) qtyByProductDay[pid] = {};

      const startMonthDate = new Date(`${month}T00:00:00.000Z`);
      for (let day = 1; day <= dim; day += 1) {
        const d = new Date(Date.UTC(startMonthDate.getUTCFullYear(), startMonthDate.getUTCMonth(), day));
        const dayIso = dateKey(d.toISOString());
        if (dayIso < startDate || dayIso > endDate) continue;
        qtyByProductDay[pid][dayIso] = (qtyByProductDay[pid][dayIso] || 0) + dailyQty;
        totalByProduct[pid] = (totalByProduct[pid] || 0) + dailyQty;
      }
    }

    const topProductIds = Object.entries(totalByProduct)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, limit)
      .map(([pid]) => pid);

    const nameByProduct: Record<string, string> = {};
    if (topProductIds.length) {
      const { data: products } = await supabase
        .from("products")
        .select("id,name")
        .in("id", topProductIds);
      (products || []).forEach((p: any) => (nameByProduct[p.id] = p.name || p.id));
    }

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

    return NextResponse.json({ startDate, endDate, labels, products, source: "sales_inventory_data" });
  } catch (e: any) {
    console.error("GET /api/analytics/product-demand-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
