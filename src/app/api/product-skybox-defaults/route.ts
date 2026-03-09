import { NextResponse } from "next/server";
import { readHomeContent, writeHomeContent } from "@/app/lib/homeContentStore";
import { normalizeSkyboxes } from "@/app/lib/productSkyboxes";

const SETTINGS_KEY = "productSkyboxDefaults";

export async function GET() {
  try {
    const content = await readHomeContent();
    const defaults = normalizeSkyboxes(content?.[SETTINGS_KEY]);
    return NextResponse.json({ skyboxes: defaults }, { status: 200 });
  } catch (error: any) {
    console.error("GET /api/product-skybox-defaults error", error);
    return NextResponse.json({ error: error?.message || "Failed to load shared skyboxes" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const nextSkyboxes = normalizeSkyboxes(body?.skyboxes);
    const content = await readHomeContent();
    const nextContent = {
      ...content,
      [SETTINGS_KEY]: nextSkyboxes,
    };

    await writeHomeContent(nextContent);
    return NextResponse.json({ skyboxes: nextSkyboxes }, { status: 200 });
  } catch (error: any) {
    console.error("PUT /api/product-skybox-defaults error", error);
    return NextResponse.json({ error: error?.message || "Failed to save shared skyboxes" }, { status: 500 });
  }
}
