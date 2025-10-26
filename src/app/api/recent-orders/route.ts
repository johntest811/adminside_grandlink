import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Service-role client (server side only)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);

    // Fetch latest pending-payment reservations (successful reservation creation)
    const { data: items, error: itemsErr } = await supabase
      .from("user_items") // Note: if your table is named `items_product`, change here
      .select("id, user_id, product_id, quantity, created_at, status, meta")
      .eq("item_type", "reservation")
      .eq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (itemsErr) {
      console.error("recent-orders: items fetch error", itemsErr);
      return NextResponse.json({ items: [], error: itemsErr.message }, { status: 200 });
    }

    if (!items || items.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // Enrich with product names
    const productIds = Array.from(new Set(items.map((r) => r.product_id))).filter(Boolean);
    const productMap: Record<string, { id: string; name?: string }> = {};
    if (productIds.length) {
      const { data: products } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds);
      (products || []).forEach((p: any) => (productMap[p.id] = { id: p.id, name: p.name }));
    }

    // Fetch user names via auth.admin for better display; fall back to email or 'User'
    const usersById: Record<string, { name: string }> = {};
    const uniqueUserIds = Array.from(new Set(items.map((r) => r.user_id))).filter(Boolean);
    for (const uid of uniqueUserIds) {
      try {
        const { data } = await (supabase as any).auth.admin.getUserById(uid);
        const email: string | undefined = data?.user?.email;
        const nameFromMeta: string | undefined = (data?.user?.user_metadata as any)?.full_name || (data?.user?.user_metadata as any)?.name;
        usersById[uid] = { name: nameFromMeta || email || "User" };
      } catch (e) {
        usersById[uid] = { name: "User" };
      }
    }

    // Map to minimal notification-like items for the admin dropdown
    const mapped = items.map((r) => {
      const productName = r.meta?.product_name || productMap[r.product_id]?.name || r.product_id;
      const userName = usersById[r.user_id]?.name || "User";
      return {
        id: r.id,
        title: "New Order",
        message: `User ${userName} has made an order\n${productName} • Qty: ${Number(r.quantity || 1)}`,
        type: "order",
        priority: "medium",
        created_at: r.created_at,
        is_read: false,
      };
    });

    return NextResponse.json({ items: mapped });
  } catch (e: any) {
    console.error("recent-orders error", e);
    return NextResponse.json({ items: [], error: e.message || "Unexpected error" }, { status: 500 });
  }
}
