import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase
    .from("user_items")
    .select(`id,user_id,product_id,item_type,status,quantity,meta,created_at,updated_at,
             reservation_fee,payment_status,special_instructions,delivery_address_id,
             balance_payment_status,balance_payment_id,total_paid,admin_notes,
             estimated_delivery_date,payment_id,price,total_amount,customer_name,
             customer_email,customer_phone,delivery_address,payment_method,
             order_status,order_progress`)
    .in("item_type", ["reservation", "order"])
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ items: data ?? [] });
}