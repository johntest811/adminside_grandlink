import { NextResponse } from "next/server";
import { patchSingletonContent, readSingletonContent } from "@/app/lib/adminSingletonContent";
import {
  mergeCategoryOptions,
  PRODUCT_CATEGORY_OPTIONS,
} from "@/app/dashboard/products/productFormConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeCategoriesFromContent(content: Record<string, any>): string[] {
  const stored = Array.isArray(content?.productCategoryOptions)
    ? content.productCategoryOptions
    : [];

  return mergeCategoryOptions(PRODUCT_CATEGORY_OPTIONS, stored);
}

export async function GET() {
  try {
    const { content, updatedAt } = await readSingletonContent();
    return NextResponse.json({
      categories: normalizeCategoriesFromContent(content),
      updatedAt,
    });
  } catch (error) {
    console.error("GET /api/product-categories error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load product categories" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const incoming = Array.isArray(body?.categories) ? body.categories : body;
    const categories = mergeCategoryOptions(Array.isArray(incoming) ? incoming : []);

    const { content, updatedAt } = await patchSingletonContent((current) => ({
      ...current,
      productCategoryOptions: categories,
    }));

    return NextResponse.json({
      categories: normalizeCategoriesFromContent(content),
      updatedAt,
    });
  } catch (error) {
    console.error("PUT /api/product-categories error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save product categories" },
      { status: 500 }
    );
  }
}
