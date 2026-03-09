import { NextResponse } from "next/server";
import { readForecastingState, updateForecastingSettings } from "@/app/lib/forecastingStore";
import { coerceForecastingSettings } from "@/app/lib/forecastingShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const state = await readForecastingState();
    return NextResponse.json(state);
  } catch (error) {
    console.error("GET /api/forecasting/settings error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load forecasting settings" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const payload = body?.settings ?? body;
    const current = coerceForecastingSettings(payload);
    const state = await updateForecastingSettings({
      autoTrainEnabled: current.autoTrainEnabled,
      autoTrainDay: current.autoTrainDay,
    });
    return NextResponse.json(state);
  } catch (error) {
    console.error("PUT /api/forecasting/settings error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save forecasting settings" },
      { status: 500 }
    );
  }
}
