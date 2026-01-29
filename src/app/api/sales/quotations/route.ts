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

function buildQuoteNumber() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `Q-${y}${m}${day}-${rand}`;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));

    const { data, error } = await supabase
      .from("quotations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ quotations: data || [] });
  } catch (e: any) {
    console.error("GET /api/sales/quotations error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      client_name,
      client_email,
      client_phone,
      items,
      discount_value,
      notes,
      created_by,
    } = body || {};

    if (!client_name) {
      return NextResponse.json({ error: "client_name is required" }, { status: 400 });
    }

    const safeItems = Array.isArray(items) ? items : [];
    const subtotal = safeItems.reduce((sum, it) => {
      const qty = Math.max(0, Number(it?.qty || 0));
      const price = Math.max(0, Number(it?.price || 0));
      return sum + qty * price;
    }, 0);

    const discount = Math.max(0, Number(discount_value || 0));
    const total = Math.max(0, subtotal - discount);

    const payload = {
      quote_number: buildQuoteNumber(),
      client_name,
      client_email: client_email || null,
      client_phone: client_phone || null,
      status: "draft",
      currency: "PHP",
      items: safeItems,
      subtotal,
      discount_value: discount,
      total_amount: total,
      notes: notes || null,
      created_by: created_by || null,
    };

    const { data, error } = await supabase.from("quotations").insert([payload]).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ quotation: data });
  } catch (e: any) {
    console.error("POST /api/sales/quotations error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { id, patch } = body as { id?: string; patch?: Record<string, any> };

    if (!id || !patch) {
      return NextResponse.json({ error: "Missing id or patch" }, { status: 400 });
    }

    const allowed: Record<string, any> = {};
    if ("status" in patch) allowed.status = patch.status;
    if ("client_name" in patch) allowed.client_name = patch.client_name;
    if ("client_email" in patch) allowed.client_email = patch.client_email || null;
    if ("client_phone" in patch) allowed.client_phone = patch.client_phone || null;
    if ("notes" in patch) allowed.notes = patch.notes || null;

    if ("items" in patch) {
      const safeItems = Array.isArray(patch.items) ? patch.items : [];
      allowed.items = safeItems;
      const subtotal = safeItems.reduce((sum, it) => {
        const qty = Math.max(0, Number(it?.qty || 0));
        const price = Math.max(0, Number(it?.price || 0));
        return sum + qty * price;
      }, 0);
      const discount = Math.max(0, Number(patch.discount_value || 0));
      allowed.subtotal = subtotal;
      allowed.discount_value = discount;
      allowed.total_amount = Math.max(0, subtotal - discount);
    } else {
      if ("discount_value" in patch) allowed.discount_value = Math.max(0, Number(patch.discount_value || 0));
      // If discount changes alone, recompute total from existing subtotal server-side
      if ("discount_value" in patch) {
        const { data: existing } = await supabase.from("quotations").select("subtotal").eq("id", id).maybeSingle();
        const subtotal = Number((existing as any)?.subtotal || 0);
        allowed.total_amount = Math.max(0, subtotal - Number(allowed.discount_value || 0));
      }
    }

    allowed.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("quotations")
      .update(allowed)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ quotation: data });
  } catch (e: any) {
    console.error("PATCH /api/sales/quotations error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { error } = await supabase.from("quotations").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("DELETE /api/sales/quotations error", e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
