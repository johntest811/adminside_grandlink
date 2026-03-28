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
             order_status`)
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
  const userIds = Array.from(new Set((items || []).map((i: any) => i.user_id).filter(Boolean)));

  const productsMap: Record<string, any> = {};
  const addressesMap: Record<string, any> = {};
  const defaultAddressByUserId: Record<string, any> = {};
  const invoicesMap: Record<string, any> = {};

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

  if (userIds.length) {
    const { data: userAddresses } = await supabase
      .from("addresses")
      .select("*")
      .in("user_id", userIds)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    for (const addr of userAddresses || []) {
      const uid = String(addr.user_id || "");
      if (!uid || defaultAddressByUserId[uid]) continue;
      defaultAddressByUserId[uid] = addr;
    }
  }

  const userItemIds = Array.from(new Set((items || []).map((i: any) => i.id).filter(Boolean)));
  if (userItemIds.length) {
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id,user_item_id,invoice_number,invoice_html,issued_at,email_sent_at,updated_at")
      .in("user_item_id", userItemIds);
    (invoices || []).forEach((invoice: any) => {
      invoicesMap[String(invoice.user_item_id)] = invoice;
    });
  }

  const enriched = (items || []).map((i: any) => ({
    ...i,
    product_details: productsMap[i.product_id] || null,
    address_details: addressesMap[i.delivery_address_id] || defaultAddressByUserId[i.user_id] || null,
    invoice_details: invoicesMap[String(i.id)] || null,
    customer: {
      name: i.customer_name || i.meta?.customer_name || null,
      email: i.customer_email || i.meta?.customer_email || null,
      phone: i.customer_phone || i.meta?.customer_phone || null,
    },
  }));

  return NextResponse.json({ items: enriched });
}