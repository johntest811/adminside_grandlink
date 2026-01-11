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

export async function GET() {
  try {
    const supabase = supabaseAdmin();

    const { data: positions, error: posErr } = await supabase
      .from("rbac_positions")
      .select("name,description")
      .order("name", { ascending: true });

    if (posErr) {
      return NextResponse.json({ error: posErr.message }, { status: 500 });
    }

    const { data: assignments, error: asgErr } = await supabase
      .from("rbac_position_pages")
      .select("position_name,page_key");

    if (asgErr) {
      return NextResponse.json({ error: asgErr.message }, { status: 500 });
    }

    const byPos: Record<string, string[]> = {};
    for (const row of assignments || []) {
      const position = row.position_name as string;
      const pageKey = row.page_key as string;
      (byPos[position] ||= []).push(pageKey);
    }

    return NextResponse.json({
      positions: (positions || []).map((p: any) => ({
        ...p,
        pageKeys: byPos[p.name] || [],
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const adminId = req.headers.get("x-admin-id");
    const auth = await requireSuperadminTyped(adminId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const name = String(body?.name || "").trim();
    const description = body?.description ? String(body.description) : null;

    if (!name) {
      return NextResponse.json({ error: "Position name is required" }, { status: 400 });
    }

    const { error } = await auth.supabase.from("rbac_positions").insert({
      name,
      description,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const adminId = req.headers.get("x-admin-id");
    const auth = await requireSuperadminTyped(adminId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await req.json();
    const name = String(body?.name || "").trim();
    const description = body?.description ? String(body.description) : null;

    if (!name) {
      return NextResponse.json({ error: "Position name is required" }, { status: 400 });
    }

    const { error } = await auth.supabase
      .from("rbac_positions")
      .update({ description })
      .eq("name", name);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const adminId = req.headers.get("x-admin-id");
    const auth = await requireSuperadminTyped(adminId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(req.url);
    const name = String(searchParams.get("name") || "").trim();

    if (!name) {
      return NextResponse.json({ error: "Position name is required" }, { status: 400 });
    }

    // Clean up assignments first (even if FK doesn't cascade).
    const { error: delAsgErr } = await auth.supabase
      .from("rbac_position_pages")
      .delete()
      .eq("position_name", name);

    if (delAsgErr) {
      return NextResponse.json({ error: delAsgErr.message }, { status: 500 });
    }

    const { error } = await auth.supabase.from("rbac_positions").delete().eq("name", name);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
