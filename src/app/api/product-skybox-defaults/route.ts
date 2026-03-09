import { NextResponse } from "next/server";
import { patchSingletonContent, readSingletonContent } from "@/app/lib/adminSingletonContent";
import { coerceGlobalSkyboxDefaults, type GlobalSkyboxDefaults } from "@/app/lib/skyboxDefaults";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeResponse(content: Record<string, any>, updatedAt: string | null) {
  return {
    defaults: coerceGlobalSkyboxDefaults(content?.productSkyboxDefaults || {}),
    updatedAt,
  };
}

export async function GET() {
  try {
    const { content, updatedAt } = await readSingletonContent();
    return NextResponse.json(normalizeResponse(content, updatedAt));
  } catch (error) {
    console.error("GET /api/product-skybox-defaults error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load skybox defaults" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const defaults = coerceGlobalSkyboxDefaults((body?.defaults ?? body) as GlobalSkyboxDefaults);
    const { content, updatedAt } = await patchSingletonContent((current) => ({
      ...current,
      productSkyboxDefaults: defaults,
    }));

    return NextResponse.json(normalizeResponse(content, updatedAt));
  } catch (error) {
    console.error("PUT /api/product-skybox-defaults error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save skybox defaults" },
      { status: 500 }
    );
  }
}
