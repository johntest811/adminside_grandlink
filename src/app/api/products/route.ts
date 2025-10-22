import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/app/lib/activity";
import { notifyProductCreated, notifyInventoryChange } from "@/app/lib/notifications";
import { adminNotificationService } from "@/utils/notificationHelper";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET all products
export async function GET(req: Request) {
  try {
    const { data: products, error } = await supabaseAdmin
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET products error:", error);
      return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
    }

    return NextResponse.json({ products: products || [] }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/products error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST create new product
export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log("📦 Creating new product:", body.name);

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

    // Insert the product
    const { data: product, error } = await supabaseAdmin
      .from("products")
      .insert(body)
      .select()
      .single();

    if (error) {
      console.error("Product creation error:", error);
      return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
    }

    console.log("✅ Product created successfully:", product.id);

    // Log activity for admin dashboard
    if (currentAdmin) {
      await logActivity({
        admin_id: currentAdmin.id,
        admin_name: currentAdmin.username,
        action: "create",
        entity_type: "products",
        entity_id: product.id,
        details: `Created new product: ${product.name}`,
        metadata: {
          product_name: product.name,
          price: product.price,
          inventory: product.inventory
        }
      });

      // Create admin notification about product creation
      await notifyProductCreated(
        product.name, 
        currentAdmin.username, 
        product.type || 'General'
      );
    }

    // Send notification to users about new product
    try {
      await adminNotificationService.notifyNewProduct(
        product.name,
        product.id,
        currentAdmin?.username || 'Admin'
      );
      console.log("🔔 User notifications sent for new product");
    } catch (notificationError) {
      console.error("❌ Failed to send user notifications:", notificationError);
      // Don't fail the request if user notification fails
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/products error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}