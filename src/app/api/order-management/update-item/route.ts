import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Single server-side client with service role (bypasses RLS and avoids auth.users permission issues)
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const allowedStatuses = [
  "active","pending_payment","pending_acceptance","reserved","accepted","approved",
  "in_production","start_packaging","ready_for_delivery","completed","cancelled","pending_cancellation"
];

const mapStatusForDB = (s: string) => {
  switch (s) {
    case "packaging":
    case "start_packaging":                  // Handle both
      return "start_packaging";
    case "quality_check":
      return "in_production";
    case "out_for_delivery":
      return "ready_for_delivery";
    case "pending_balance_payment":
      return "reserved";
    default:
      return s;
  }
};

const progressMap: Record<string, string> = {
  pending_payment: "awaiting_payment",
  reserved: "payment_confirmed",
  approved: "in_production",
  in_production: "in_production",
  quality_check: "quality_check",
  start_packaging: "packaging",
  packaging: "packaging",
  ready_for_delivery: "ready_for_delivery",
  out_for_delivery: "out_for_delivery",
  completed: "delivered",
  cancelled: "cancelled",
  pending_cancellation: "pending_cancellation",
  pending_balance_payment: "balance_due",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { itemId, updates, restoreInventory } = body as {
      itemId: string;
      updates: Record<string, any>;
      restoreInventory?: { productId: string; quantity: number };
    };

    if (!itemId || !updates) {
      return NextResponse.json({ error: "Missing itemId or updates" }, { status: 400 });
    }

    const { data: current } = await supabase
      .from("user_items")
      .select("progress_history, meta, product_id, quantity, status, order_status")
      .eq("id", itemId)
      .single();

    // If UI sent a detailed stage, normalize and populate companion fields
    const uiStage: string | undefined = (updates.order_status as string) || (updates.status as string);
    if (typeof uiStage === "string") {
      const dbStage = mapStatusForDB(uiStage);
      if (allowedStatuses.includes(dbStage)) {
        updates.status = dbStage;
      } else {
        delete updates.status; // do not break the update on invalid input
      }
      updates.order_status = uiStage;
      updates.order_progress = progressMap[uiStage] || uiStage;

      // Append progress_history atomically (fetch current first)
      const now = new Date().toISOString();
      const nextHistory = [
        ...((current as any)?.progress_history ?? []),
        { status: uiStage, updated_at: now, admin: updates?.admin_name ?? null },
      ];
      updates.progress_history = nextHistory;
      updates.updated_at = now;
    }

    const currentMeta = ((current as any)?.meta || {}) as Record<string, any>;
    const productId = (current as any)?.product_id as string | undefined;
    const quantity = Number((current as any)?.quantity || 0);
    const previousInventoryReserved = Boolean(currentMeta?.inventory_reserved);
    const requestedOrderStatus = (updates.order_status as string) || (updates.status as string) || (current as any)?.order_status || (current as any)?.status;
    const normalizedOrderStatus = requestedOrderStatus === 'approve_cancellation' ? 'cancelled' : requestedOrderStatus;

    let inventoryAction: 'reserve' | 'restore' | null = null;
    if (!previousInventoryReserved && normalizedOrderStatus === 'approved') {
      inventoryAction = 'reserve';
    } else if (previousInventoryReserved && normalizedOrderStatus === 'cancelled') {
      inventoryAction = 'restore';
    }

    const metaTimestamp = new Date().toISOString();
    let productInventoryBefore: number | undefined;
    let productInventoryAfter: number | undefined;

    if (inventoryAction && productId) {
      const { data: product } = await supabase
        .from('products')
        .select('inventory')
        .eq('id', productId)
        .single();

      if (product) {
        productInventoryBefore = Number(product.inventory || 0);
        if (inventoryAction === 'reserve') {
          productInventoryAfter = Math.max(0, productInventoryBefore - quantity);
        } else {
          productInventoryAfter = productInventoryBefore + quantity;
        }
      }
    }

    const mergedMeta = {
      ...currentMeta,
      ...(updates.meta || {}),
    } as Record<string, any>;

    if (inventoryAction && productInventoryBefore !== undefined && productInventoryAfter !== undefined) {
      if (inventoryAction === 'reserve') {
        mergedMeta.inventory_reserved = true;
        mergedMeta.inventory_reserved_at = metaTimestamp;
      } else {
        mergedMeta.inventory_reserved = false;
        mergedMeta.inventory_restocked_at = metaTimestamp;
      }
      mergedMeta.product_stock_before = productInventoryBefore;
      mergedMeta.product_stock_after = productInventoryAfter;
    }

    if (updates.meta) {
      updates.meta = mergedMeta;
    } else if (Object.keys(mergedMeta).length > 0) {
      updates.meta = mergedMeta;
    }

    // Update user_items row
    const { data: item, error: itemErr } = await supabase
      .from("user_items")
      .update(updates)
      .eq("id", itemId)
      .select("*")
      .single();

    if (itemErr) {
      console.error("❌ Supabase error:", itemErr);
      return NextResponse.json({ error: itemErr.message }, { status: 400 });
    }

    // Optionally restore inventory (server-side only)
    if (inventoryAction && productId && productInventoryAfter !== undefined) {
      const { error: invErr } = await supabase
        .from('products')
        .update({ inventory: productInventoryAfter })
        .eq('id', productId);
      if (invErr) {
        console.warn('⚠️ Inventory update warn:', invErr.message);
      }
    } else if (restoreInventory?.productId && typeof restoreInventory.quantity === "number") {
      const { data: prod, error: fetchErr } = await supabase
        .from("products")
        .select("inventory")
        .eq("id", restoreInventory.productId)
        .single();

      if (!fetchErr && prod) {
        const newInv = (prod.inventory || 0) + restoreInventory.quantity;
        const { error: invErr } = await supabase
          .from("products")
          .update({ inventory: newInv })
          .eq("id", restoreInventory.productId);
        if (invErr) console.warn("⚠️ Inventory update warn:", invErr.message);
      } else if (fetchErr) {
        console.warn("⚠️ Fetch product warn:", fetchErr.message);
      }
    }

    return NextResponse.json({ success: true, item });
  } catch (e: any) {
    console.error("💥 API error:", e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
