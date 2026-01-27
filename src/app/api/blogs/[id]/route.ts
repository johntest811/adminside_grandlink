import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/app/lib/activity";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function getAdminFromHeader(req: Request): { id: string; username: string } | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  try {
    const parsed = JSON.parse(authHeader);
    if (!parsed?.id || !parsed?.username) return null;
    return { id: String(parsed.id), username: String(parsed.username) };
  } catch {
    return null;
  }
}

function sanitizeHtmlLoose(input: unknown) {
  const html = typeof input === "string" ? input : "";
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = getAdminFromHeader(req);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("blogs")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      console.error("GET /api/blogs/[id] error", error);
      return NextResponse.json({ error: "Failed to fetch blog" }, { status: 500 });
    }

    return NextResponse.json({ blog: data }, { status: 200 });
  } catch (e) {
    console.error("GET /api/blogs/[id] exception", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = getAdminFromHeader(req);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));

    const update: any = {};

    if (body?.title !== undefined) update.title = String(body.title || "").trim();
    if (body?.slug !== undefined) update.slug = String(body.slug || "").trim();
    if (body?.excerpt !== undefined) update.excerpt = body.excerpt ?? null;
    if (body?.cover_image_url !== undefined) update.cover_image_url = body.cover_image_url ?? null;
    if (body?.author_name !== undefined) update.author_name = body.author_name ?? null;
    if (body?.content_html !== undefined) update.content_html = sanitizeHtmlLoose(body.content_html);
    if (body?.is_published !== undefined) update.is_published = !!body.is_published;
    if (body?.published_at !== undefined) update.published_at = body.published_at ? String(body.published_at) : null;

    update.updated_by_admin_id = admin.id;

    if (Object.keys(update).length <= 1) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("blogs")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
      }
      console.error("PATCH /api/blogs/[id] error", error);
      return NextResponse.json({ error: "Failed to update blog" }, { status: 500 });
    }

    await logActivity({
      admin_id: admin.id,
      admin_name: admin.username,
      action: "update",
      entity_type: "blogs",
      entity_id: id,
      details: `Updated blog: ${data.title}`,
      page: "Blogs Editor",
      metadata: { slug: data.slug, is_published: data.is_published },
    }).catch(() => {});

    return NextResponse.json({ blog: data }, { status: 200 });
  } catch (e) {
    console.error("PATCH /api/blogs/[id] exception", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const admin = getAdminFromHeader(req);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await ctx.params;
    const supabase = supabaseAdmin();

    // Fetch for logging
    const { data: existing } = await supabase
      .from("blogs")
      .select("id, title, slug")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("blogs").delete().eq("id", id);

    if (error) {
      console.error("DELETE /api/blogs/[id] error", error);
      return NextResponse.json({ error: "Failed to delete blog" }, { status: 500 });
    }

    await logActivity({
      admin_id: admin.id,
      admin_name: admin.username,
      action: "delete",
      entity_type: "blogs",
      entity_id: id,
      details: `Deleted blog: ${existing?.title || id}`,
      page: "Blogs Editor",
      metadata: { slug: existing?.slug },
    }).catch(() => {});

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("DELETE /api/blogs/[id] exception", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
