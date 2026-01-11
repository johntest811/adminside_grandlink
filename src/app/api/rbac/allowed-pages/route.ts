import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const adminId = searchParams.get("adminId");

    if (!adminId) {
      return NextResponse.json({ error: "adminId is required" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const { data: adminRow, error: adminErr } = await supabase
      .from("admins")
      .select("id,role,position")
      .eq("id", adminId)
      .maybeSingle();

    if (adminErr) {
      return NextResponse.json({ error: adminErr.message }, { status: 500 });
    }
    if (!adminRow) {
      return NextResponse.json({ error: "Admin not found" }, { status: 404 });
    }

    const role = String(adminRow.role || "").toLowerCase().replace(/[\s_-]/g, "");
    const pos = String((adminRow as any).position || "").toLowerCase().replace(/[\s_-]/g, "");

    // Superadmins can access everything.
    if (role === "superadmin" || pos === "superadmin") {
      const { data: pages, error } = await supabase
        .from("rbac_pages")
        .select("path");
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ allowedPaths: (pages || []).map((p: any) => p.path) });
    }

    const position = adminRow.position ? String(adminRow.position) : null;
    if (!position) {
      return NextResponse.json({ allowedPaths: ["/dashboard"] });
    }

    // Join position -> pages
    // rbac_position_pages(position_name,page_key) -> rbac_pages(key,path)
    const { data: rows, error: joinErr } = await supabase
      .from("rbac_position_pages")
      .select("rbac_pages(path)")
      .eq("position_name", position);

    if (joinErr) {
      return NextResponse.json({ error: joinErr.message }, { status: 500 });
    }

    const allowedPaths = new Set<string>();
    allowedPaths.add("/dashboard");
    for (const row of rows || []) {
      const nested = (row as any).rbac_pages;
      const path = nested?.path;
      if (typeof path === "string" && path.length) allowedPaths.add(path);
    }

    return NextResponse.json({ allowedPaths: Array.from(allowedPaths) });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
