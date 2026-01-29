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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));

    const { data, error } = await supabase
      .from("invoices")
      .select(
        "id,user_item_id,user_id,invoice_number,currency,subtotal,addons_total,discount_value,reservation_fee,total_amount,payment_method,issued_at,email_sent_at,created_at,updated_at"
      )
      .order("issued_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invoices: data || [] });
  } catch (e: any) {
    console.error("GET /api/sales/invoices error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, patch } = body as { id?: string; patch?: Record<string, any> };

    if (!id || !patch || typeof patch !== "object") {
      return NextResponse.json({ error: "Missing id or patch" }, { status: 400 });
    }

    const allowed: Record<string, any> = {};
    if ("payment_method" in patch) allowed.payment_method = patch.payment_method || null;
    if ("email_sent_at" in patch) allowed.email_sent_at = patch.email_sent_at || null;
    if ("meta" in patch) allowed.meta = patch.meta;

    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("invoices")
      .update(allowed)
      .eq("id", id)
      .select(
        "id,user_item_id,user_id,invoice_number,currency,subtotal,addons_total,discount_value,reservation_fee,total_amount,payment_method,issued_at,email_sent_at,created_at,updated_at"
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ invoice: data });
  } catch (e: any) {
    console.error("PATCH /api/sales/invoices error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
