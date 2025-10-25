import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");

  let query = supabase
    .from("user_items")
    .select(`id,user_id,product_id,item_type,status,quantity,meta,created_at,updated_at,
             reservation_fee,payment_status,special_instructions,delivery_address_id,
             balance_payment_status,balance_payment_id,total_paid,admin_notes,
             estimated_delivery_date,payment_id,price,total_amount,customer_name,
             customer_email,customer_phone,delivery_address,payment_method,
             order_status,order_progress`)
    .in("item_type", ["reservation", "order"]) as any;

  // Optional status filter: match either DB status or UI order_status
  if (statusFilter) {
    // Use an OR across status and order_status; order_progress can be different wording
    query = query.or(`status.eq.${statusFilter},order_status.eq.${statusFilter}`);
  }

  const { data: items, error } = await query.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Enrich with product and address details (best-effort)
  const productIds = Array.from(new Set((items || []).map((i: any) => i.product_id).filter(Boolean)));
  const addressIds = Array.from(new Set((items || []).map((i: any) => i.delivery_address_id).filter(Boolean)));

  const productsMap: Record<string, any> = {};
  const addressesMap: Record<string, any> = {};

  if (productIds.length) {
    const { data: products } = await supabase
      .from("products")
      .select("id,name,price,category,images,fbx_url")
      .in("id", productIds);
    (products || []).forEach((p: any) => { productsMap[p.id] = p; });
  }

  if (addressIds.length) {
    const { data: addresses } = await supabase
      .from("addresses")
      .select("*")
      .in("id", addressIds);
    (addresses || []).forEach((a: any) => { addressesMap[a.id] = a; });
  }

  const enriched = (items || []).map((i: any) => ({
    ...i,
    product_details: productsMap[i.product_id] || null,
    address_details: addressesMap[i.delivery_address_id] || null,
    customer: {
      name: i.customer_name || i.meta?.customer_name || null,
      email: i.customer_email || i.meta?.customer_email || null,
      phone: i.customer_phone || i.meta?.customer_phone || null,
    },
  }));

  return NextResponse.json({ items: enriched });
}