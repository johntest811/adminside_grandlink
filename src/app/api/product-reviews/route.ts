import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { POSITION_PERMISSIONS, type Position } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CacheEntry<T> = { value: T; expiresAt: number };
const REVIEWS_CACHE = new Map<string, CacheEntry<any>>();
const REVIEWS_CACHE_TTL_MS = 20_000;

function getCacheKey(productId: string | null) {
  return productId ? `product:${productId}` : "all";
}

function parseAdminFromHeader(req: Request): any | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  try {
    return JSON.parse(authHeader);
  } catch {
    return null;
  }
}

function normalize(value?: string | null) {
  return String(value || "").toLowerCase().replace(/[\s_-]/g, "");
}

function adminHasAction(admin: any | null, action: "read" | "delete") {
  if (!admin) return false;

  const roleNorm = normalize(admin?.role);
  const positionNorm = normalize(admin?.position);
  if (roleNorm === "superadmin" || positionNorm === "superadmin") return true;

  const position = admin?.position as Position | undefined;
  const perms = position ? POSITION_PERMISSIONS[position] : undefined;
  return Boolean(perms?.actions?.includes(action));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");

    const admin = parseAdminFromHeader(req);
    if (!adminHasAction(admin, "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cacheKey = getCacheKey(productId);
    const cached = REVIEWS_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ reviews: cached.value }, { status: 200 });
    }

    let query = supabaseAdmin
      .from("product_reviews")
      .select("id, product_id, user_id, rating, comment, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (productId) {
      query = query.eq("product_id", productId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("GET /api/product-reviews error:", error);
      return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 });
    }

    const reviews = data || [];
    REVIEWS_CACHE.set(cacheKey, { value: reviews, expiresAt: Date.now() + REVIEWS_CACHE_TTL_MS });
    return NextResponse.json({ reviews }, { status: 200 });
  } catch (err: any) {
    console.error("GET /api/product-reviews exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = parseAdminFromHeader(req);
    if (!adminHasAction(admin, "delete")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const reviewId = body?.reviewId;
    if (!reviewId) {
      return NextResponse.json({ error: "reviewId is required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from("product_reviews").delete().eq("id", reviewId);

    if (error) {
      console.error("DELETE /api/product-reviews error:", error);
      return NextResponse.json({ error: "Failed to delete review" }, { status: 500 });
    }

    // Invalidate caches
    REVIEWS_CACHE.clear();

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("DELETE /api/product-reviews exception:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
