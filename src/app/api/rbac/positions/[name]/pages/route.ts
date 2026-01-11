import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireSuperadmin(adminId: string | null) {
  if (!adminId) return { ok: false, status: 401, error: "Missing admin id" };

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("admins")
    .select("id,role,position")
    .eq("id", adminId)
    .maybeSingle();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 401, error: "Admin not found" };
  const roleNorm = String(data.role).toLowerCase().replace(/[\s_-]/g, "");
  const posNorm = String((data as any).position || "").toLowerCase().replace(/[\s_-]/g, "");
  if (roleNorm !== "superadmin" && posNorm !== "superadmin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: true, supabase } as const;
}

type RequireSuperadminResult =
  | { ok: true; supabase: ReturnType<typeof supabaseAdmin> }
  | { ok: false; status: number; error: string };

async function requireSuperadminTyped(adminId: string | null): Promise<RequireSuperadminResult> {
  return (await requireSuperadmin(adminId)) as RequireSuperadminResult;
}

export async function PUT(req: Request, context: { params: Promise<{ name: string }> }) {
  try {
    const adminId = req.headers.get("x-admin-id");
    const auth = await requireSuperadminTyped(adminId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const params = await context.params;
    const positionName = decodeURIComponent(params.name);
    const body = await req.json();

    const pageKeys: string[] = Array.isArray(body?.pageKeys)
      ? body.pageKeys.map((k: any) => String(k))
      : [];

    // Replace assignments for this position in a transaction-ish way:
    // 1) delete existing
    // 2) insert new
    const { error: delErr } = await auth.supabase
      .from("rbac_position_pages")
      .delete()
      .eq("position_name", positionName);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    if (pageKeys.length > 0) {
      const rows = pageKeys.map((pageKey) => ({
        position_name: positionName,
        page_key: pageKey,
      }));

      const { error: insErr } = await auth.supabase
        .from("rbac_position_pages")
        .insert(rows);

      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
