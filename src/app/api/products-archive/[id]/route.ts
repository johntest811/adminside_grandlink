import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const toObjectPath = (url: string): string | null => {
  const marker = "/storage/v1/object/public/products/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
};

// Permanently delete an archived product and its stored files
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = supabaseAdmin();

    // Get current admin (for audit logs)
    const authHeader = req.headers.get("authorization");
    let currentAdmin: { id: string; username: string } | null = null;
    try {
      if (authHeader) currentAdmin = JSON.parse(authHeader);
    } catch {}

    const { data: archived, error: fetchError } = await supabase
      .from("products_archive")
      .select("id, product_id, product_name, product_data")
      .eq("id", id)
      .single();

    if (fetchError || !archived) {
      return NextResponse.json({ error: "Archived product not found" }, { status: 404 });
    }

    // Best-effort storage cleanup
    try {
      const product = (archived as any).product_data || {};
      const urls: string[] = [];
      const addUrl = (u?: string | null) => {
        if (u && typeof u === "string") urls.push(u);
      };

      addUrl(product.image1);
      addUrl(product.image2);
      addUrl(product.image3);
      addUrl(product.image4);
      addUrl(product.image5);
      if (Array.isArray(product.images)) {
        for (const u of product.images) addUrl(u);
      }
      addUrl(product.fbx_url);
      if (Array.isArray(product.fbx_urls)) {
        for (const u of product.fbx_urls) addUrl(u);
      }

      const paths = urls.map(toObjectPath).filter((p): p is string => !!p);
      if (paths.length) {
        const { error: removeErr } = await supabase.storage.from("products").remove(paths);
        if (removeErr) {
          console.warn("⚠️ Storage removal error:", removeErr.message);
        }
      }
    } catch (storageErr) {
      console.warn("⚠️ Storage cleanup error (non-fatal):", storageErr);
    }

    // Delete archive record
    const { error: deleteError } = await supabase.from("products_archive").delete().eq("id", id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Audit log (best-effort)
    try {
      if (currentAdmin?.id) {
        await supabase.from("activity_logs").insert([
          {
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "delete",
            entity_type: "products_archive",
            entity_id: archived.product_id,
            details: `Permanently deleted archived product: ${archived.product_name || archived.product_id}`,
            page: "inventory/trash",
            metadata: {
              archive_id: archived.id,
              product_id: archived.product_id,
              deleted_at: new Date().toISOString(),
            },
          },
        ]);
      }
    } catch {}

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}

// Restore an archived product back into products table
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const supabase = supabaseAdmin();

    const authHeader = req.headers.get("authorization");
    let currentAdmin: { id: string; username: string } | null = null;
    try {
      if (authHeader) currentAdmin = JSON.parse(authHeader);
    } catch {}

    const { data: archived, error: fetchError } = await supabase
      .from("products_archive")
      .select("id, product_id, product_name, product_data")
      .eq("id", id)
      .single();

    if (fetchError || !archived) {
      return NextResponse.json({ error: "Archived product not found" }, { status: 404 });
    }

    const productData = ((archived as any).product_data || {}) as Record<string, any>;

    // Restore from the stored snapshot. This snapshot came from SELECT * on products,
    // so it should already match the table schema. Avoid querying information_schema
    // (not reliably exposed via Supabase PostgREST).
    const restoreData: Record<string, any> = { ...productData };
    restoreData.id = (archived as any).product_id;

    // Upsert so restore works even if the product was recreated.
    let upserted: any = null;
    let upsertError: any = null;

    {
      const { data, error } = await supabase
        .from("products")
        .upsert([restoreData], { onConflict: "id" })
        .select("id")
        .single();
      upserted = data;
      upsertError = error;
    }

    // Fallback: if the DB schema is missing a legacy optional column that existed when the product was archived
    // (common example: images), retry without that field.
    if (upsertError) {
      const msg = String(upsertError.message || "").toLowerCase();
      const retryData: Record<string, any> = { ...restoreData };
      const maybeDrop: string[] = [];
      if (msg.includes("column") && msg.includes("images") && msg.includes("does not exist")) maybeDrop.push("images");
      if (msg.includes("column") && msg.includes("fbx_urls") && msg.includes("does not exist")) maybeDrop.push("fbx_urls");

      if (maybeDrop.length) {
        for (const k of maybeDrop) delete retryData[k];
        const { data, error } = await supabase
          .from("products")
          .upsert([retryData], { onConflict: "id" })
          .select("id")
          .single();
        upserted = data;
        upsertError = error;
      }
    }

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Remove from archive after successful restore
    const { error: deleteArchiveErr } = await supabase.from("products_archive").delete().eq("id", id);
    if (deleteArchiveErr) {
      // Not fatal; restored product exists. Return warning.
      return NextResponse.json(
        { success: true, restoredId: upserted?.id, warning: deleteArchiveErr.message },
        { status: 200 }
      );
    }

    // Audit log (best-effort)
    try {
      if (currentAdmin?.id) {
        await supabase.from("activity_logs").insert([
          {
            admin_id: currentAdmin.id,
            admin_name: currentAdmin.username,
            action: "update",
            entity_type: "products_archive",
            entity_id: (archived as any).product_id,
            details: `Restored product from Archive/Trashcan: ${(archived as any).product_name || (archived as any).product_id}`,
            page: "inventory/trash",
            metadata: {
              archive_id: (archived as any).id,
              product_id: (archived as any).product_id,
              restored_at: new Date().toISOString(),
            },
          },
        ]);
      }
    } catch {}

    return NextResponse.json({ success: true, restoredId: upserted?.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 });
  }
}
