import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdminClient() {
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

const normalize = (v?: string | null) =>
  String(v || "").toLowerCase().replace(/[\s_-]/g, "");

async function canDeleteUsers(
  supabase: any,
  requesterAdminId?: string | null
) {
  if (!supabase || !requesterAdminId) return false;

  const { data: adminRow } = await supabase
    .from("admins")
    .select("id, role, position")
    .eq("id", requesterAdminId)
    .maybeSingle();

  if (!adminRow) return false;

  const role = normalize((adminRow as any).role);
  const position = normalize((adminRow as any).position);

  if (role === "superadmin" || position === "superadmin") return true;

  const allowedPaths = new Set<string>();
  const rawPosition =
    (adminRow as any).position != null
      ? String((adminRow as any).position)
      : null;

  if (rawPosition) {
    const { data: rows } = await supabase
      .from("rbac_position_pages")
      .select("rbac_pages(path)")
      .eq("position_name", rawPosition);

    for (const row of rows || []) {
      const path = (row as any)?.rbac_pages?.path;
      if (typeof path === "string" && path.trim()) {
        allowedPaths.add(path.trim());
      }
    }
  }

  const { data: overrides } = await supabase
    .from("rbac_admin_page_overrides")
    .select("rbac_pages(path)")
    .eq("admin_id", requesterAdminId);

  for (const row of overrides || []) {
    const path = (row as any)?.rbac_pages?.path;
    if (typeof path === "string" && path.trim()) {
      allowedPaths.add(path.trim());
    }
  }

  return (
    allowedPaths.has("/dashboard/user-accounts/delete") ||
    allowedPaths.has("/dashboard/user-accounts#delete") ||
    allowedPaths.has("/dashboard/settings/roles#admin-overrides")
  );
}

export async function POST(request: Request) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
      },
      { status: 500 }
    );
  }

  const { email, password } = await request.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data.user, success: true });
}

function extractUserStatus(user: any) {
  const appMeta = user?.app_metadata || {};
  const userMeta = user?.user_metadata || {};
  const deactivated =
    Boolean(appMeta?.deactivated_account) ||
    Boolean(userMeta?.deactivated_account) ||
    Boolean(appMeta?.is_deactivated) ||
    Boolean(userMeta?.is_deactivated);

  return {
    deactivated_account: deactivated,
    deactivated_at: appMeta?.deactivated_at || userMeta?.deactivated_at || null,
  };
}

export async function GET(request: Request) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
      },
      { status: 500 }
    );
  }

  const requesterAdminId = request.headers.get("x-admin-id");
  const canDelete = await canDeleteUsers(supabase, requesterAdminId);

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const users = (data.users || []).map((user: any) => ({
    ...user,
    ...extractUserStatus(user),
  }));

  return NextResponse.json({ users, canDelete });
}

export async function PATCH(request: Request) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
      },
      { status: 500 }
    );
  }

  const { userId, deactivated } = await request.json();

  if (!userId || typeof deactivated !== "boolean") {
    return NextResponse.json(
      { error: "userId and deactivated(boolean) are required" },
      { status: 400 }
    );
  }

  const { data: existing, error: existingErr } =
    await supabase.auth.admin.getUserById(userId);

  if (existingErr || !existing?.user) {
    return NextResponse.json(
      { error: existingErr?.message || "User not found" },
      { status: 404 }
    );
  }

  const currentMeta =
    ((existing.user.user_metadata || {}) as Record<string, unknown>) || {};

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMeta,
      deactivated_account: deactivated,
      is_deactivated: deactivated,
      deactivated_at: deactivated ? new Date().toISOString() : null,
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
      },
      { status: 500 }
    );
  }

  const requesterAdminId = request.headers.get("x-admin-id");
  const deleteAllowed = await canDeleteUsers(supabase, requesterAdminId);
  if (!deleteAllowed) {
    return NextResponse.json(
      { error: "You do not have permission to delete user accounts" },
      { status: 403 }
    );
  }

  const { userId } = await request.json();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
