import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const { code, type, value, min_subtotal, max_uses, starts_at, expires_at, active = true } = await req.json();
    if (!code || !type || typeof value !== "number") {
      return NextResponse.json({ error: "code, type, value required" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("discount_codes")
      .insert({ code: String(code).toUpperCase(), type, value, min_subtotal, max_uses, starts_at, expires_at, active })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, discount: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to create discount" }, { status: 500 });
  }
}