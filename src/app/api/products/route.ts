import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logActivity } from "@/app/lib/activity";
import { notifyProductCreated } from "@/app/lib/notifications";
import { adminNotificationService } from "@/utils/notificationHelper";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

// GET all products
export async function GET() {
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
    } catch {
      console.log("No admin auth found in header");
    }

    // Insert the product
    let product: any = null;
    let error: any = null;

    {
      const result = await supabaseAdmin
        .from("products")
        .insert(body)
        .select()
        .single();
      product = result.data;
      error = result.error;
    }

    // Backward compatible fallback if optional JSON/array columns don't exist yet
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      const fallbackBody: any = { ...body };
      let changed = false;
      if (msg.includes("images")) {
        delete fallbackBody.images;
        changed = true;
      }
      if (msg.includes("skyboxes")) {
        delete fallbackBody.skyboxes;
        changed = true;
      }
      if (msg.includes("house_model_url")) {
        delete fallbackBody.house_model_url;
        changed = true;
      }
      if (changed) {
        const retry = await supabaseAdmin
          .from("products")
          .insert(fallbackBody)
          .select()
          .single();
        product = retry.data;
        error = retry.error;
      }
    }

    if (error) {
      console.error("Product creation error:", error);
      return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
    }

    console.log("✅ Product created successfully:", product.id);

    const sideEffects: Promise<unknown>[] = [];

    if (currentAdmin) {
      sideEffects.push(
        logActivity({
          admin_id: currentAdmin.id,
          admin_name: currentAdmin.username,
          action: "create",
          entity_type: "products",
          entity_id: product.id,
          details: `Created new product: ${product.name}`,
          metadata: {
            product_name: product.name,
            price: product.price,
            inventory: product.inventory,
          },
        })
      );

      sideEffects.push(
        notifyProductCreated(
          product.name,
          currentAdmin.username,
          product.type || "General"
        )
      );
    }

    sideEffects.push(
      withTimeout(
        adminNotificationService.notifyNewProduct(
          product.name,
          product.id,
          currentAdmin?.username || "Admin"
        ),
        1500
      )
    );

    await Promise.allSettled(sideEffects);

    return NextResponse.json({ product }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/products error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}