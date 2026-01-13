import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const norm = (v?: string | null) => String(v || "").toLowerCase().replace(/[\s_-]/g, "");

async function getAllowedPaths(supabase: ReturnType<typeof supabaseAdmin>, adminId: string) {
  const { data: adminRow, error: adminErr } = await supabase
    .from("admins")
    .select("id,role,position")
    .eq("id", adminId)
    .maybeSingle();

  if (adminErr) return { ok: false as const, status: 500, error: adminErr.message };
  if (!adminRow) return { ok: false as const, status: 404, error: "Admin not found" };

  const role = norm(adminRow.role);
  const pos = norm((adminRow as any).position);

  // Superadmins can access everything.
  if (role === "superadmin" || pos === "superadmin") {
    const { data: pages, error } = await supabase.from("rbac_pages").select("path");
    if (error) return { ok: false as const, status: 500, error: error.message };
    return { ok: true as const, paths: new Set((pages || []).map((p: any) => p.path)) };
  }

  const allowed = new Set<string>();
  allowed.add("/dashboard");

  const positionName = adminRow.position ? String(adminRow.position) : null;
  if (positionName) {
    const { data: rows, error: joinErr } = await supabase
      .from("rbac_position_pages")
      .select("rbac_pages(path)")
      .eq("position_name", positionName);

    if (joinErr) return { ok: false as const, status: 500, error: joinErr.message };

    for (const row of rows || []) {
      const nested = (row as any).rbac_pages;
      const path = nested?.path;
      if (typeof path === "string" && path.length) allowed.add(path);
    }
  }

  // Admin overrides are optional
  const { data: overrides, error: ovErr } = await supabase
    .from("rbac_admin_page_overrides")
    .select("rbac_pages(path)")
    .eq("admin_id", adminId);

  if (!ovErr) {
    for (const row of overrides || []) {
      const nested = (row as any).rbac_pages;
      const path = nested?.path;
      if (typeof path === "string" && path.length) allowed.add(path);
    }
  }

  return { ok: true as const, paths: allowed };
}

export async function GET(req: Request) {
  try {
    const requesterId = req.headers.get("x-admin-id");
    if (!requesterId) {
      return NextResponse.json({ error: "Missing x-admin-id" }, { status: 401 });
    }

    const supabase = supabaseAdmin();
    const allowedRes = await getAllowedPaths(supabase, requesterId);
    if (!allowedRes.ok) {
      return NextResponse.json({ error: allowedRes.error }, { status: allowedRes.status });
    }

    // Must be able to access Roles page to list admins.
    if (!allowedRes.paths.has("/dashboard/settings/roles")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("admins")
      .select("id,username,role,position,is_active,created_at")
      .order("username", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ admins: data || [] });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
