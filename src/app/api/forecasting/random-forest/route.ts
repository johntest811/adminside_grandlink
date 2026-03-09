import { NextResponse } from "next/server";
import { runRandomForestForecast } from "@/app/lib/forecastingServerRunner";
import { saveForecastingRun } from "@/app/lib/forecastingStore";
import type { SalesSeriesResponse, ForecastingRunMode } from "@/app/lib/forecastingShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const series = (body?.series || null) as SalesSeriesResponse | null;
    const lookback = Number(body?.lookback || 14);
    const horizon = Number(body?.horizon || 30);
    const backtestDays = Number(body?.backtestDays || 28);
    const persist = body?.persist !== false;
    const mode: ForecastingRunMode = body?.mode === "auto" ? "auto" : "manual";

    if (!series?.labels?.length || !Array.isArray(series.revenue) || !Array.isArray(series.quantities)) {
      return NextResponse.json({ error: "Missing sales series payload" }, { status: 400 });
    }

    const result = await runRandomForestForecast({
      series,
      lookback,
      horizon,
      backtestDays,
    });

    if (persist) {
      await saveForecastingRun({
        mode,
        status: "success",
        randomForest: result,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/forecasting/random-forest error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run Random Forest forecasting" },
      { status: 500 }
    );
  }
}
