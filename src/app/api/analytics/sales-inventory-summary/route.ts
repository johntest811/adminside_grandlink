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

function monthKeyFromDate(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function monthKeysForLast36Months() {
  const keys: string[] = [];
  const now = new Date();
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 35; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - i, 1));
    keys.push(monthKeyFromDate(d));
  }
  return keys;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const branch = (url.searchParams.get("branch") || "").trim();

    const months = monthKeysForLast36Months();
    const startMonth = months[0];
    const endMonth = months[months.length - 1];

    let query = supabase
      .from("sales_inventory_data")
      .select("product_id,month_start,branch,units_sold,revenue,source_user_items_count")
      .gte("month_start", startMonth)
      .lte("month_start", endMonth)
      .order("month_start", { ascending: true })
      .limit(100000);

    if (branch) query = query.eq("branch", branch);

    const { data: rows, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const safeRows = rows || [];
    const monthRevenueMap: Record<string, number> = {};
    const monthUnitsMap: Record<string, number> = {};
    const productRevenueMap: Record<string, number> = {};
    const productUnitsMap: Record<string, number> = {};
    const branchSet = new Set<string>();
    const productSet = new Set<string>();

    for (const month of months) {
      monthRevenueMap[month] = 0;
      monthUnitsMap[month] = 0;
    }

    let sourceRows = 0;
    for (const row of safeRows as any[]) {
      const month = String(row.month_start || "").slice(0, 10);
      if (!monthRevenueMap[month] && monthRevenueMap[month] !== 0) continue;

      const revenue = Math.max(0, Number(row.revenue || 0));
      const units = Math.max(0, Number(row.units_sold || 0));
      const productId = String(row.product_id || "");
      const branchName = String(row.branch || "unknown");

      monthRevenueMap[month] += revenue;
      monthUnitsMap[month] += units;
      sourceRows += Math.max(0, Number(row.source_user_items_count || 0));

      if (productId) {
        productSet.add(productId);
        productRevenueMap[productId] = (productRevenueMap[productId] || 0) + revenue;
        productUnitsMap[productId] = (productUnitsMap[productId] || 0) + units;
      }
      if (branchName) branchSet.add(branchName);
    }

    const productIds = Object.keys(productRevenueMap);
    const productNameById: Record<string, string> = {};
    if (productIds.length) {
      const { data: products } = await supabase
        .from("products")
        .select("id,name")
        .in("id", productIds.slice(0, 2000));
      for (const p of products || []) {
        productNameById[String((p as any).id)] = String((p as any).name || (p as any).id);
      }
    }

    const monthlyRevenue = months.map((month) => monthRevenueMap[month] || 0);
    const monthlyUnits = months.map((month) => monthUnitsMap[month] || 0);
    const monthsWithData = months.filter((month) => (monthRevenueMap[month] || 0) > 0 || (monthUnitsMap[month] || 0) > 0).length;

    const topProducts = Object.entries(productRevenueMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([productId, revenue]) => ({
        product_id: productId,
        product_name: productNameById[productId] || productId,
        revenue,
        units_sold: productUnitsMap[productId] || 0,
      }));

    const totalRevenue = monthlyRevenue.reduce((sum, value) => sum + value, 0);
    const totalUnits = monthlyUnits.reduce((sum, value) => sum + value, 0);

    return NextResponse.json({
      windowMonths: 36,
      startMonth,
      endMonth,
      branch: branch || null,
      months,
      monthlyRevenue,
      monthlyUnits,
      totalRevenue,
      totalUnits,
      monthsWithData,
      dataCompletenessPct: (monthsWithData / 36) * 100,
      productCount: productSet.size,
      branchCount: branchSet.size,
      sourceRows,
      topProducts,
    });
  } catch (e: any) {
    console.error("GET /api/analytics/sales-inventory-summary error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
