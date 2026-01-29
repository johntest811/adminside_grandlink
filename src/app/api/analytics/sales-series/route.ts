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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 180);

    const startDate = url.searchParams.get("start") || dateKey(start.toISOString());
    const endDate = url.searchParams.get("end") || dateKey(end.toISOString());

    const { data: items, error } = await supabase
      .from("user_items")
      .select("id,product_id,quantity,created_at,status,order_status,total_paid,item_type")
      .gte("created_at", `${startDate}T00:00:00.000Z`)
      .lte("created_at", `${endDate}T23:59:59.999Z`)
      .in("item_type", ["order", "reservation"])
      .limit(50000);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const successStatuses = new Set([
      "reserved",
      "approved",
      "in_production",
      "start_packaging",
      "ready_for_delivery",
      "completed",
    ]);

    // price fallback map
    const productIds = Array.from(new Set((items || []).map((r: any) => r.product_id))).filter(Boolean);
    const priceByProduct: Record<string, number> = {};
    if (productIds.length) {
      const { data: products } = await supabase
        .from("products")
        .select("id,price")
        .in("id", productIds);
      (products || []).forEach((p: any) => (priceByProduct[p.id] = Number(p.price || 0)));
    }

    const labels = enumerateDates(startDate, endDate);
    const revenueByDay: Record<string, number> = {};
    const qtyByDay: Record<string, number> = {};
    labels.forEach((d) => {
      revenueByDay[d] = 0;
      qtyByDay[d] = 0;
    });

    for (const row of items || []) {
      const s = String(row.order_status || row.status || "").toLowerCase();
      if (!successStatuses.has(s)) continue;
      const d = dateKey(row.created_at);
      if (!revenueByDay[d] && revenueByDay[d] !== 0) continue;
      const qty = Math.max(0, Number(row.quantity || 0));
      const paid = Number(row.total_paid || 0);
      const fallback = qty * (priceByProduct[row.product_id] || 0);
      const revenue = paid > 0 ? paid : fallback;
      revenueByDay[d] += revenue;
      qtyByDay[d] += qty;
    }

    return NextResponse.json({
      startDate,
      endDate,
      labels,
      revenue: labels.map((d) => revenueByDay[d] || 0),
      quantities: labels.map((d) => qtyByDay[d] || 0),
    });
  } catch (e: any) {
    console.error("GET /api/analytics/sales-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
