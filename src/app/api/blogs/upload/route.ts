import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/app/lib/activity";

export const runtime = "nodejs";

const BUCKET = "blog-images";

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

function makeSafeFileName(name: string) {
  return String(name || "file")
    .trim()
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
}

export async function POST(req: Request) {
  try {
    const admin = getAdminFromHeader(req);
    if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (!file.type?.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
    }

    const safeName = makeSafeFileName(file.name);
    const objectPath = `blogs/${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`;

    const supabase = supabaseAdmin();

    const bytes = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, bytes, {
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message || "Upload failed" }, { status: 400 });
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
    const publicUrl = urlData?.publicUrl || null;

    await logActivity({
      admin_id: admin.id,
      admin_name: admin.username,
      action: "upload",
      entity_type: "storage",
      entity_id: objectPath,
      details: `Uploaded image to ${BUCKET}`,
      page: "Blogs Editor",
      metadata: { bucket: BUCKET, objectPath, publicUrl, fileName: file.name, fileType: file.type, fileSize: file.size },
    }).catch(() => {});

    return NextResponse.json(
      { bucket: BUCKET, path: objectPath, publicUrl },
      { status: 200 }
    );
  } catch (e) {
    console.error("POST /api/blogs/upload exception", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
