import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// List archived products (trashcan)
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));

    const supabase = supabaseAdmin();

    let query = supabase
      .from("products_archive")
      .select(
        "id, product_id, product_name, product_category, product_price, archived_at, archived_by, archived_by_name"
      )
      .order("archived_at", { ascending: false })
      .limit(limit);

    if (q) {
      // This requires product_name/category columns, which our SQL will add.
      query = query.or(`product_name.ilike.%${q}%,product_category.ilike.%${q}%`);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ items: data || [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}
