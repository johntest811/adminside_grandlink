import { NextResponse } from "next/server";
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

export async function GET() {
  try {
    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 1095);

    const startDate = dateKey(start.toISOString());
    const endDate = dateKey(end.toISOString());
    const startMonth = monthStartISO(startDate);
    const endMonth = monthStartISO(endDate);

    const { data: monthlyRows, error } = await supabase
      .from("sales_inventory_data")
      .select("month_start,revenue,units_sold")
      .gte("month_start", startMonth)
      .lte("month_start", endMonth)
      .limit(100000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const revenueByMonth: Record<string, number> = {};
    const unitsByMonth: Record<string, number> = {};
    for (const row of monthlyRows || []) {
      const month = String((row as any).month_start || "").slice(0, 10);
      if (!month) continue;
      revenueByMonth[month] = (revenueByMonth[month] || 0) + Math.max(0, Number((row as any).revenue || 0));
      unitsByMonth[month] = (unitsByMonth[month] || 0) + Math.max(0, Number((row as any).units_sold || 0));
    }

    const labels = enumerateDates(startDate, endDate);

    const revenue = labels.map((dayIso) => {
      const month = monthStartISO(dayIso);
      const total = revenueByMonth[month] || 0;
      const dim = daysInMonthFromMonthStart(month);
      return total / Math.max(1, dim);
    });
    const quantities = labels.map((dayIso) => {
      const month = monthStartISO(dayIso);
      const total = unitsByMonth[month] || 0;
      const dim = daysInMonthFromMonthStart(month);
      return total / Math.max(1, dim);
    });

    return NextResponse.json({
      startDate,
      endDate,
      labels,
      revenue,
      quantities,
      source: "sales_inventory_data",
    });
  } catch (e: any) {
    console.error("GET /api/analytics/sales-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
