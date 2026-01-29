import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { RandomForestRegression as RFRegression } from "ml-random-forest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  price: number | null;
  inventory: number | null;
  reserved_stock: number | null;
};

type UserItemRow = {
  product_id: string;
  quantity: number;
  created_at: string;
  status: string | null;
  order_status: string | null;
  item_type: string | null;
};

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

function mean(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = clampInt(Number(url.searchParams.get("days") || 120), 30, 365);
    const horizon = clampInt(Number(url.searchParams.get("horizon") || 14), 7, 60);
    const lookback = clampInt(Number(url.searchParams.get("lookback") || 7), 3, 30);

    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - days);

    // 1) Load products snapshot
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("id,name,category,price,inventory,reserved_stock")
      .order("name", { ascending: true });

    if (prodErr) {
      return NextResponse.json({ error: prodErr.message }, { status: 500 });
    }

    // 2) Load recent demand (user_items)
    const { data: items, error: itemErr } = await supabase
      .from("user_items")
      .select("product_id,quantity,created_at,status,order_status,item_type")
      .gte("created_at", start.toISOString())
      .in("item_type", ["order", "reservation"])
      .limit(50000);

    if (itemErr) {
      return NextResponse.json({ error: itemErr.message }, { status: 500 });
    }

    const demandStatuses = new Set([
      "reserved",
      "approved",
      "in_production",
      "start_packaging",
      "ready_for_delivery",
      "completed",
    ]);

    // Aggregate daily qty per product
    const byProductDay: Record<string, Record<string, number>> = {};
    for (const r of (items || []) as UserItemRow[]) {
      const s = String(r.order_status || r.status || "").toLowerCase();
      if (!demandStatuses.has(s)) continue;
      if (!r.product_id) continue;
      const key = dateKey(r.created_at);
      (byProductDay[r.product_id] ||= {});
      byProductDay[r.product_id][key] = (byProductDay[r.product_id][key] || 0) + Math.max(0, Number(r.quantity || 0));
    }

    const dateLabels = enumerateDates(dateKey(start.toISOString()), dateKey(end.toISOString()));

    const recommendations = (products || []).map((p: ProductRow) => {
      const daily = dateLabels.map((d) => byProductDay[p.id]?.[d] || 0);
      const available = Math.max(0, Number(p.inventory || 0) - Number(p.reserved_stock || 0));

      // Build lagged dataset: predict next-day demand from last `lookback` days
      const X: number[][] = [];
      const y: number[] = [];
      for (let i = lookback; i < daily.length; i++) {
        X.push(daily.slice(i - lookback, i));
        y.push(daily[i]);
      }

      let forecastTotal = 0;
      let forecastDaily: number[] = [];
      let method: "rf" | "avg" = "avg";

      const avg = mean(daily);
      const s = std(daily);
      const safety = Math.max(1, Math.ceil(1.65 * s)); // simple service-level buffer

      if (X.length >= Math.max(10, lookback * 2)) {
        try {
          const rf = new RFRegression({
            nEstimators: 80,
            maxFeatures: Math.max(1, Math.floor(Math.sqrt(lookback))),
            replacement: true,
            seed: 42,
          });
          rf.train(X, y);

          method = "rf";
          const window = daily.slice(daily.length - lookback);
          let w = window.slice();
          forecastDaily = [];
          for (let i = 0; i < horizon; i++) {
            const next = (rf.predict([w]) as number[])[0];
            const clipped = Math.max(0, next);
            forecastDaily.push(clipped);
            w = w.slice(1).concat(clipped);
          }
          forecastTotal = forecastDaily.reduce((a, b) => a + b, 0);
        } catch {
          // fall back below
        }
      }

      if (!forecastDaily.length) {
        forecastDaily = new Array(horizon).fill(avg);
        forecastTotal = avg * horizon;
        method = "avg";
      }

      const recommendedMin = Math.max(0, Math.ceil(forecastTotal + safety));
      const recommendedOrderQty = Math.max(0, recommendedMin - available);

      const risk =
        available <= 0
          ? "out" as const
          : available <= 5
          ? "low" as const
          : recommendedOrderQty > 0
          ? "reorder" as const
          : "ok" as const;

      return {
        product_id: p.id,
        name: p.name,
        category: p.category,
        available,
        inventory: p.inventory ?? 0,
        reserved_stock: p.reserved_stock ?? 0,
        horizon_days: horizon,
        lookback_days: lookback,
        demand_avg_per_day: avg,
        safety_stock: safety,
        forecast_total: Math.round(forecastTotal * 100) / 100,
        recommended_min_stock: recommendedMin,
        recommended_order_qty: recommendedOrderQty,
        method,
        risk,
      };
    });

    return NextResponse.json({
      window_days: days,
      horizon_days: horizon,
      lookback_days: lookback,
      recommendations,
    });
  } catch (e: any) {
    console.error("GET /api/analytics/inventory-recommendations error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
