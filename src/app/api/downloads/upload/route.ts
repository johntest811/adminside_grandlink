import { NextResponse } from "next/server";
import { gzipSync } from "zlib";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOWNLOADS_BUCKET = "Downloads";

function getAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: Request) {
  try {
    const supabase = getAdminClient();
    if (!supabase) {
      return NextResponse.json({ error: "Missing Supabase service-role environment variables" }, { status: 500 });
    }

    const contentType = req.headers.get("content-type") || "";

    // Preferred mode for large files: create a signed upload URL and upload directly to Supabase from browser.
    if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null);
      const originalName = String(body?.fileName || "app-release.apk");
      const fileSize = Number(body?.fileSize || 0);

      if (!/\.apk$/i.test(originalName)) {
        return NextResponse.json({ error: "Only .apk files are allowed" }, { status: 400 });
      }

      const maxBytes = 1024 * 1024 * 1024; // 1GB
      if (!Number.isFinite(fileSize) || fileSize <= 0) {
        return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
      }
      if (fileSize > maxBytes) {
        return NextResponse.json({ error: "APK is too large (max 1GB)" }, { status: 400 });
      }

      const safeName = sanitizeFilename(originalName);
      const ts = Date.now();
      const originalPath = `apk/${ts}-${safeName}`;

      const signed = await supabase.storage.from(DOWNLOADS_BUCKET).createSignedUploadUrl(originalPath, {
        upsert: true,
      });

      if (signed.error || !signed.data) {
        return NextResponse.json({ error: signed.error?.message || "Failed to create signed upload URL" }, { status: 500 });
      }

      const originalUrl = supabase.storage.from(DOWNLOADS_BUCKET).getPublicUrl(originalPath).data.publicUrl;

      return NextResponse.json({
        ok: true,
        mode: "signed",
        bucket: DOWNLOADS_BUCKET,
        fileName: safeName,
        originalPath,
        originalUrl,
        originalBytes: fileSize,
        signedPath: signed.data.path,
        signedToken: signed.data.token,
        note: "Use signed upload for large APK files to bypass Vercel request body limits.",
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    const originalName = file.name || "app-release.apk";
    if (!/\.apk$/i.test(originalName)) {
      return NextResponse.json({ error: "Only .apk files are allowed" }, { status: 400 });
    }

    const maxBytes = 1024 * 1024 * 1024; // 1GB
    if (file.size > maxBytes) {
      return NextResponse.json({ error: "APK is too large (max 1GB)" }, { status: 400 });
    }

    const safeName = sanitizeFilename(originalName);
    const ts = Date.now();
    const originalPath = `apk/${ts}-${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    const originalBuffer = Buffer.from(arrayBuffer);

    // Keep installable APK untouched and upload it as the main artifact.
    const uploadOriginal = await supabase.storage.from(DOWNLOADS_BUCKET).upload(originalPath, originalBuffer, {
      contentType: "application/vnd.android.package-archive",
      upsert: true,
      cacheControl: "31536000",
    });

    if (uploadOriginal.error) {
      return NextResponse.json({ error: uploadOriginal.error.message }, { status: 500 });
    }

    const originalUrlRes = supabase.storage.from(DOWNLOADS_BUCKET).getPublicUrl(originalPath);
    const originalUrl = originalUrlRes.data.publicUrl;

    // Storage optimization: keep a gzip companion only if it is meaningfully smaller.
    const gzBuffer = gzipSync(originalBuffer, { level: 9 });
    const ratio = Number((gzBuffer.length / Math.max(1, originalBuffer.length)).toFixed(4));
    const isSmaller = gzBuffer.length < originalBuffer.length * 0.98;

    let compressedPath: string | null = null;
    let compressedUrl: string | null = null;

    if (isSmaller) {
      compressedPath = `${originalPath}.gz`;
      const uploadCompressed = await supabase.storage.from(DOWNLOADS_BUCKET).upload(compressedPath, gzBuffer, {
        contentType: "application/gzip",
        upsert: true,
        cacheControl: "31536000",
      });

      if (!uploadCompressed.error) {
        compressedUrl = supabase.storage.from(DOWNLOADS_BUCKET).getPublicUrl(compressedPath).data.publicUrl;
      }
    }

    return NextResponse.json({
      ok: true,
      fileName: safeName,
      originalPath,
      originalUrl,
      originalBytes: originalBuffer.length,
      compressedPath,
      compressedUrl,
      compressedBytes: compressedPath ? gzBuffer.length : null,
      compressionRatio: compressedPath ? ratio : null,
      note: "APK is uploaded unchanged for install safety. A gzip companion is stored only when smaller.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Upload failed" }, { status: 500 });
  }
}
