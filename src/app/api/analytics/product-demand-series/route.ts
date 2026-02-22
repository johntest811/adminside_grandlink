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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = 1095;
    const limit = Math.max(3, Math.min(50, Number(url.searchParams.get("limit") || 12)));
    const branch = (url.searchParams.get("branch") || "").trim();

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - days);

    const startDate = url.searchParams.get("start") || dateKey(start.toISOString());
    const endDate = url.searchParams.get("end") || dateKey(end.toISOString());

    const baseSelect = branch
      ? "product_id,quantity,created_at,status,order_status,item_type,delivery_address_id"
      : "product_id,quantity,created_at,status,order_status,item_type";

    const { data: items, error } = await supabase
      .from("user_items")
      .select(baseSelect)
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

    const labels = enumerateDates(startDate, endDate);

    let filteredItems = items || [];
    if (branch) {
      const addressIds = Array.from(
        new Set(
          (filteredItems as any[])
            .map((r) => r.delivery_address_id)
            .filter((id) => typeof id === "string" && id.length > 0)
        )
      ) as string[];

      if (addressIds.length === 0) {
        filteredItems = [];
      } else {
        const { data: addresses, error: addressesError } = await supabase
          .from("addresses")
          .select("id,branch")
          .in("id", addressIds);
        if (addressesError) return NextResponse.json({ error: addressesError.message }, { status: 500 });

        const branchById = new Map<string, string>();
        for (const a of addresses || []) {
          if (a?.id) branchById.set(a.id, String(a.branch || "").trim().toLowerCase());
        }

        const wanted = branch.toLowerCase();
        filteredItems = (filteredItems as any[]).filter((r) => {
          const id = r.delivery_address_id as string | null;
          if (!id) return false;
          return (branchById.get(id) || "") === wanted;
        });
      }
    }

    // daily qty per product
    const qtyByProductDay: Record<string, Record<string, number>> = {};
    const totalByProduct: Record<string, number> = {};

    for (const row of filteredItems as any[]) {
      const s = String(row.order_status || row.status || "").toLowerCase();
      if (!successStatuses.has(s)) continue;
      const pid = row.product_id;
      if (!pid) continue;
      const d = dateKey(row.created_at);
      const qty = Math.max(0, Number(row.quantity || 0));

      if (!qtyByProductDay[pid]) qtyByProductDay[pid] = {};
      qtyByProductDay[pid][d] = (qtyByProductDay[pid][d] || 0) + qty;
      totalByProduct[pid] = (totalByProduct[pid] || 0) + qty;
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

    return NextResponse.json({ startDate, endDate, labels, products });
  } catch (e: any) {
    console.error("GET /api/analytics/product-demand-series error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
