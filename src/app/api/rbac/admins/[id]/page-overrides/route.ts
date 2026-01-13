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

async function isSuperadmin(supabase: ReturnType<typeof supabaseAdmin>, adminId: string) {
  const { data, error } = await supabase
    .from("admins")
    .select("id,role,position")
    .eq("id", adminId)
    .maybeSingle();
  if (error || !data) return false;
  return norm(data.role) === "superadmin" || norm((data as any).position) === "superadmin";
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const requesterId = req.headers.get("x-admin-id");
    if (!requesterId) {
      return NextResponse.json({ error: "Missing x-admin-id" }, { status: 401 });
    }

    const { id: targetAdminId } = await context.params;
    const supabase = supabaseAdmin();

    const allowedRes = await getAllowedPaths(supabase, requesterId);
    if (!allowedRes.ok) {
      return NextResponse.json({ error: allowedRes.error }, { status: allowedRes.status });
    }

    // Anyone who can access Roles page can view overrides.
    // (Or you can always view your own.)
    if (requesterId !== targetAdminId && !allowedRes.paths.has("/dashboard/settings/roles")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("rbac_admin_page_overrides")
      .select("page_key")
      .eq("admin_id", targetAdminId);

    // If table isn't present yet, treat as none.
    if (error) {
      return NextResponse.json({ pageKeys: [] });
    }

    return NextResponse.json({ pageKeys: (data || []).map((r: any) => r.page_key) });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const requesterId = req.headers.get("x-admin-id");
    if (!requesterId) {
      return NextResponse.json({ error: "Missing x-admin-id" }, { status: 401 });
    }

    const { id: targetAdminId } = await context.params;
    const supabase = supabaseAdmin();

    const requesterIsSuperadmin = await isSuperadmin(supabase, requesterId);

    // Non-superadmins must have the manage-admin-overrides capability.
    if (!requesterIsSuperadmin) {
      const allowedRes = await getAllowedPaths(supabase, requesterId);
      if (!allowedRes.ok) {
        return NextResponse.json({ error: allowedRes.error }, { status: allowedRes.status });
      }
      if (!allowedRes.paths.has("/dashboard/settings/roles#admin-overrides")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Also, non-superadmins cannot edit a superadmin's overrides.
      const targetIsSuper = await isSuperadmin(supabase, targetAdminId);
      if (targetIsSuper) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // And they can only grant pages they themselves already have access to.
      const body = await req.json();
      const pageKeys: string[] = Array.isArray(body?.pageKeys) ? body.pageKeys : [];

      const { data: pages, error: pagesErr } = await supabase
        .from("rbac_pages")
        .select("key,path")
        .in("key", pageKeys);

      if (pagesErr) return NextResponse.json({ error: pagesErr.message }, { status: 500 });

      const allowedSet = allowedRes.paths;
      const notAllowed = (pages || []).filter((p: any) => !allowedSet.has(p.path));
      if (notAllowed.length) {
        return NextResponse.json(
          {
            error: "You can only grant permissions you already have.",
            notAllowed: notAllowed.map((p: any) => p.key),
          },
          { status: 403 }
        );
      }

      // Proceed with the already-parsed body
      // (fall through)
      const { error: delErr } = await supabase
        .from("rbac_admin_page_overrides")
        .delete()
        .eq("admin_id", targetAdminId);

      // Ignore delete errors if table doesn't exist
      if (delErr && !String(delErr.message || "").toLowerCase().includes("does not exist")) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }

      if (pageKeys.length) {
        const rows = pageKeys.map((k) => ({
          admin_id: targetAdminId,
          page_key: k,
          created_by: requesterId,
        }));

        const { error: insErr } = await supabase
          .from("rbac_admin_page_overrides")
          .insert(rows);

        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    // Superadmin can set any overrides.
    const body = await req.json();
    const pageKeys: string[] = Array.isArray(body?.pageKeys) ? body.pageKeys : [];

    const { error: delErr } = await supabase
      .from("rbac_admin_page_overrides")
      .delete()
      .eq("admin_id", targetAdminId);

    if (delErr && !String(delErr.message || "").toLowerCase().includes("does not exist")) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    if (pageKeys.length) {
      const rows = pageKeys.map((k) => ({
        admin_id: targetAdminId,
        page_key: k,
        created_by: requesterId,
      }));

      const { error: insErr } = await supabase.from("rbac_admin_page_overrides").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
