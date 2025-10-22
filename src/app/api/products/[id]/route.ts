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

    return NextResponse.json({ product }, { status: 200 });
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

    // Update the product
    const { data: updatedProduct, error: updateError } = await supabaseAdmin
      .from("products")
      .update(body)
      .eq("id", id)
      .select()
      .single();

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

    return NextResponse.json({ product: updatedProduct }, { status: 200 });
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