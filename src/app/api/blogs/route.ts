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
  // Minimal hardening: remove <script> tags and inline event handlers.
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
}

// GET /api/blogs?includeUnpublished=1
export async function GET(req: Request) {
  try {
    const admin = getAdminFromHeader(req);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const includeUnpublished = url.searchParams.get("includeUnpublished") === "1";

    const supabase = supabaseAdmin();

    let q = supabase
      .from("blogs")
      .select(
        "id, title, slug, excerpt, cover_image_url, author_name, is_published, published_at, created_at, updated_at"
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (!includeUnpublished) {
      q = q.eq("is_published", true);
    }

    const { data, error } = await q;
    if (error) {
      console.error("GET /api/blogs error", error);
      return NextResponse.json({ error: "Failed to fetch blogs" }, { status: 500 });
    }

    return NextResponse.json({ blogs: data || [] }, { status: 200 });
  } catch (e) {
    console.error("GET /api/blogs exception", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/blogs
export async function POST(req: Request) {
  try {
    const admin = getAdminFromHeader(req);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    const title = String(body?.title || "").trim();
    const slug = String(body?.slug || "").trim();
    if (!title || !slug) {
      return NextResponse.json({ error: "Title and slug are required" }, { status: 400 });
    }

    const payload = {
      title,
      slug,
      excerpt: (body?.excerpt ?? null) as string | null,
      cover_image_url: (body?.cover_image_url ?? null) as string | null,
      author_name: (body?.author_name ?? null) as string | null,
      content_html: sanitizeHtmlLoose(body?.content_html),
      is_published: !!body?.is_published,
      published_at: body?.published_at ? String(body.published_at) : null,
      created_by_admin_id: admin.id,
      updated_by_admin_id: admin.id,
    };

    const supabase = supabaseAdmin();

    const { data: inserted, error } = await supabase.from("blogs").insert(payload).select().single();

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
      }
      console.error("POST /api/blogs error", error);
      return NextResponse.json({ error: "Failed to create blog" }, { status: 500 });
    }

    await logActivity({
      admin_id: admin.id,
      admin_name: admin.username,
      action: "create",
      entity_type: "blogs",
      entity_id: inserted.id,
      details: `Created blog: ${inserted.title}`,
      page: "Blogs Editor",
      metadata: { slug: inserted.slug, is_published: inserted.is_published },
    }).catch(() => {});

    return NextResponse.json({ blog: inserted }, { status: 201 });
  } catch (e) {
    console.error("POST /api/blogs exception", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
