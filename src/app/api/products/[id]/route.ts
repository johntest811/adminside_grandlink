import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity, detectChanges, formatChangesForDisplay } from "@/app/lib/activity";
import { notifyProductUpdated, notifyInventoryChange } from "@/app/lib/notifications";
import { adminNotificationService } from "@/utils/notificationHelper";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET single product
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Ensure clients always receive an images[] array for unlimited-images UX
    const computedImages = Array.isArray((product as any).images)
      ? (product as any).images
      : [
          (product as any).image1,
          (product as any).image2,
          (product as any).image3,
          (product as any).image4,
          (product as any).image5,
        ].filter(Boolean);

    const productOut = { ...product, images: computedImages };
    return NextResponse.json({ product: productOut }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/products/[id] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT (update) single product
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
  const body = await req.json();
    
    console.log("📝 Updating product:", id);

    // Get current admin from request headers
    const authHeader = req.headers.get("authorization");
    let currentAdmin = null;
    try {
      if (authHeader) {
        currentAdmin = JSON.parse(authHeader);
      }
    } catch (e) {
      console.log("No admin auth found in header");
    }

    // Get existing product for comparison
    const { data: existingProduct } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    // Prepare update data with backward compatibility (sync legacy image1..5)
    const updateData: any = { ...body };
    if (Array.isArray(body?.images)) {
      const imgs: string[] = body.images;
      updateData.image1 = imgs[0] || null;
      updateData.image2 = imgs[1] || null;
      updateData.image3 = imgs[2] || null;
      updateData.image4 = imgs[3] || null;
      updateData.image5 = imgs[4] || null;
    }

    // Update the product (attempt with images[] if column exists)
    let updatedProduct: any = null;
    let updateError: any = null;
    {
      const { data, error } = await supabaseAdmin
        .from("products")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();
      updatedProduct = data;
      updateError = error;
    }

    // Fallback if "images" column doesn't exist
    if (updateError && String(updateError.message || '').toLowerCase().includes('images')) {
      try {
        const fallbackData = { ...updateData };
        delete fallbackData.images;
        const { data, error } = await supabaseAdmin
          .from("products")
          .update(fallbackData)
          .eq("id", id)
          .select()
          .single();
        updatedProduct = data;
        updateError = error;
      } catch (e) {
        // keep original error
      }
    }

    if (updateError) {
      console.error("Product update error:", updateError);
      return NextResponse.json({ error: "Failed to update product" }, { status: 500 });
    }

    console.log("✅ Product updated successfully");

    // Detect changes for logging
    const { changes, hasChanges } = detectChanges(existingProduct, updatedProduct);
    
    if (hasChanges && currentAdmin) {
      // Log activity
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "update",
        entity_type: "products",
        entity_id: id,
        details: `Updated product: ${updatedProduct.name} - ${formatChangesForDisplay(changes)}`,
        metadata: {
          product_name: updatedProduct.name,
          changes: changes
        }
      });

      // Create admin notification about product update
      await notifyProductUpdated(
        updatedProduct.name,
        currentAdmin.username,
        Object.keys(changes).length,
        Object.keys(changes)
      );

      // Check if inventory/stock changed
      const oldInventory = existingProduct.inventory || 0;
      const newInventory = updatedProduct.inventory || 0;
      
      if (oldInventory !== newInventory) {
        console.log(`📊 Inventory changed: ${oldInventory} → ${newInventory}`);
        
        // Log specific inventory change
        await notifyInventoryChange(
          updatedProduct.name,
          oldInventory,
          newInventory,
          currentAdmin.username
        );

        // If stock increased significantly (was low/zero and now has stock), notify users
        if (oldInventory <= 5 && newInventory > 5) {
          try {
            await adminNotificationService.notifyStockUpdate(
              updatedProduct.name,
              updatedProduct.id,
              newInventory,
              currentAdmin.username
            );
            console.log("🔔 Stock update notifications sent to users");
          } catch (notificationError) {
            console.error("❌ Failed to send stock notifications:", notificationError);
          }
        }
      }
    }

    // Ensure response includes images[] even if DB lacks the column
    const computedImages = Array.isArray((updatedProduct as any)?.images)
      ? (updatedProduct as any).images
      : [
          (updatedProduct as any).image1,
          (updatedProduct as any).image2,
          (updatedProduct as any).image3,
          (updatedProduct as any).image4,
          (updatedProduct as any).image5,
        ].filter(Boolean);

    const productOut = { ...updatedProduct, images: computedImages };
    return NextResponse.json({ product: productOut }, { status: 200 });
  } catch (err: any) {
    console.error("PUT /api/products/[id] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE single product
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    
    // Get current admin
    const authHeader = req.headers.get("authorization");
    let currentAdmin = null;
    try {
      if (authHeader) {
        currentAdmin = JSON.parse(authHeader);
      }
    } catch (e) {
      console.log("No admin auth found in header");
    }

    // Get product details before deletion
    const { data: product } = await supabaseAdmin
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Attempt to remove any associated storage objects (best-effort)
    try {
      const urls: string[] = [];
      const addUrl = (u?: string | null) => { if (u && typeof u === 'string') urls.push(u); };
      addUrl((product as any)?.image1);
      addUrl((product as any)?.image2);
      addUrl((product as any)?.image3);
      addUrl((product as any)?.image4);
      addUrl((product as any)?.image5);
      if (Array.isArray((product as any)?.images)) {
        for (const u of (product as any).images) addUrl(u);
      }
      addUrl((product as any)?.fbx_url);
      if (Array.isArray((product as any)?.fbx_urls)) {
        for (const u of (product as any).fbx_urls) addUrl(u);
      }

      const toObjectPath = (url: string): string | null => {
        const marker = "/storage/v1/object/public/products/";
        const idx = url.indexOf(marker);
        if (idx === -1) return null;
        return url.slice(idx + marker.length);
      };

      const paths = urls.map(toObjectPath).filter((p): p is string => !!p);
      if (paths.length) {
        const { error: removeErr } = await supabaseAdmin.storage.from("products").remove(paths);
        if (removeErr) {
          console.warn("⚠️ Failed removing product files from storage:", removeErr.message);
        }
      }
    } catch (storageErr) {
      console.warn("⚠️ Storage cleanup error (non-fatal):", storageErr);
    }

    // Delete the product
    const { error: deleteError } = await supabaseAdmin
      .from("products")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Product deletion error:", deleteError);
      return NextResponse.json({ error: "Failed to delete product" }, { status: 500 });
    }

    // Log activity
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "delete",
        entity_type: "products",
        entity_id: id,
        details: `Deleted product: ${product.name}`,
        metadata: {
          product_name: product.name,
          deleted_at: new Date().toISOString()
        }
      });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("DELETE /api/products/[id] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}