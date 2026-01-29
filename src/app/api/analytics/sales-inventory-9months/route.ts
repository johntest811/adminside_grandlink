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

function monthKey(iso: string) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const months = Math.max(1, Math.min(18, Number(url.searchParams.get("months") || 9)));

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - months * 31);

    const startISO = start.toISOString();

    const { data: items, error } = await supabase
      .from("user_items")
      .select(
        "product_id,quantity,created_at,status,order_status,total_paid,item_type,delivery_address_id"
      )
      .gte("created_at", startISO)
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

    const addressIds = Array.from(
      new Set((items || []).map((r: any) => r.delivery_address_id).filter(Boolean))
    );

    const branchByAddressId: Record<string, string> = {};
    if (addressIds.length) {
      const { data: addrs } = await supabase
        .from("addresses")
        .select("id,branch")
        .in("id", addressIds);
      (addrs || []).forEach((a: any) => {
        branchByAddressId[a.id] = (a.branch || "unknown") as string;
      });
    }

    const productIds = Array.from(
      new Set((items || []).map((r: any) => r.product_id).filter(Boolean))
    );

    const priceByProduct: Record<string, number> = {};
    if (productIds.length) {
      const { data: products } = await supabase
        .from("products")
        .select("id,price")
        .in("id", productIds);
      (products || []).forEach((p: any) => (priceByProduct[p.id] = Number(p.price || 0)));
    }

    // Aggregate monthly rows
    const agg: Record<string, { product_id: string; month_start: string; branch: string; units_sold: number; revenue: number }> =
      {};

    for (const row of items || []) {
      const s = String(row.order_status || row.status || "").toLowerCase();
      if (!successStatuses.has(s)) continue;
      const product_id = row.product_id;
      if (!product_id) continue;

      const month_start = monthKey(row.created_at);
      const branch = branchByAddressId[row.delivery_address_id] || "unknown";
      const qty = Math.max(0, Number(row.quantity || 0));

      const paid = Number(row.total_paid || 0);
      const fallback = qty * (priceByProduct[product_id] || 0);
      const revenue = paid > 0 ? paid : fallback;

      const key = `${product_id}|${month_start}|${branch}`;
      if (!agg[key]) {
        agg[key] = { product_id, month_start, branch, units_sold: 0, revenue: 0 };
      }
      agg[key].units_sold += qty;
      agg[key].revenue += revenue;
    }

    const rows = Object.values(agg);

    // Upsert into the table (requires SUPABASE_SALES_INVENTORY_9MONTHS.sql to be applied)
    if (rows.length) {
      const { error: upsertError } = await supabase
        .from("sales_inventory_9months")
        .upsert(rows, { onConflict: "product_id,month_start,branch" });

      if (upsertError) {
        return NextResponse.json(
          {
            error: upsertError.message,
            hint: "Did you run SUPABASE_SALES_INVENTORY_9MONTHS.sql?",
            rowsComputed: rows.length,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ months, startISO, rowsUpserted: rows.length, rows });
  } catch (e: any) {
    console.error("GET /api/analytics/sales-inventory-9months error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
