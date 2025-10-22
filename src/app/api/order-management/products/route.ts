import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/app/lib/activity";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, category, inventory, updated_at")
      .order("name", { ascending: true });

    if (error) {
      console.error("GET /api/order-management/products error:", error);
      return NextResponse.json({ success: false, error: "Failed to load products" }, { status: 500 });
    }

    return NextResponse.json({ success: true, products: data ?? [] });
  } catch (error) {
    console.error("Unexpected error in GET /api/order-management/products", error);
    return NextResponse.json({ success: false, error: "Unexpected error loading products" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { productId, inventory, admin } = body || {};

    if (!productId || typeof inventory !== "number" || Number.isNaN(inventory)) {
      return NextResponse.json({ success: false, error: "Invalid payload" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("products")
      .update({
        inventory,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId)
      .select("id, name, category, inventory, updated_at")
      .single();

    if (error) {
      console.error("PATCH /api/order-management/products error:", error);
      return NextResponse.json({ success: false, error: "Failed to update inventory" }, { status: 500 });
    }

    if (admin?.id && admin?.username) {
      await logActivity({
        admin_id: admin.id,
        admin_name: admin.username,
        action: "update",
        entity_type: "product",
        entity_id: productId,
        details: `Updated inventory for ${data?.name ?? productId} to ${inventory}`,
        page: "order-management",
        metadata: {
          productId,
          inventory,
        },
      });
    }

    return NextResponse.json({ success: true, product: data });
  } catch (error) {
    console.error("Unexpected error in PATCH /api/order-management/products", error);
    return NextResponse.json({ success: false, error: "Unexpected error updating inventory" }, { status: 500 });
  }
}
