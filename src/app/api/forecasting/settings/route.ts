import { NextResponse } from "next/server";
import { readHomeContent, writeHomeContent } from "@/app/lib/homeContentStore";

const SETTINGS_KEY = "forecastingSettings";

const DEFAULT_SETTINGS = {
  autoTrainEnabled: false,
  autoTrainDay: 1,
  lastAutoTrainAt: null as string | null,
};

export async function GET() {
  try {
    const content = await readHomeContent();
    const saved = content?.[SETTINGS_KEY] ?? {};
    return NextResponse.json(
      {
        settings: {
          ...DEFAULT_SETTINGS,
          ...(saved && typeof saved === "object" ? saved : {}),
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("GET /api/forecasting/settings error", error);
    return NextResponse.json({ error: error?.message || "Failed to load forecasting settings" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const incoming = body?.settings ?? body;
    const nextSettings = {
      ...DEFAULT_SETTINGS,
      ...(incoming && typeof incoming === "object" ? incoming : {}),
      autoTrainEnabled: Boolean(incoming?.autoTrainEnabled),
      autoTrainDay: Math.max(0, Math.min(6, Number(incoming?.autoTrainDay ?? DEFAULT_SETTINGS.autoTrainDay) || 0)),
      lastAutoTrainAt: typeof incoming?.lastAutoTrainAt === "string" && incoming.lastAutoTrainAt.trim()
        ? incoming.lastAutoTrainAt
        : null,
    };

    const content = await readHomeContent();
    await writeHomeContent({
      ...content,
      [SETTINGS_KEY]: nextSettings,
    });

    return NextResponse.json({ settings: nextSettings }, { status: 200 });
  } catch (error: any) {
    console.error("PUT /api/forecasting/settings error", error);
    return NextResponse.json({ error: error?.message || "Failed to save forecasting settings" }, { status: 500 });
  }
}
