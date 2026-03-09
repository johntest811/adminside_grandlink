import { NextResponse } from "next/server";
import { runLstmForecast } from "@/app/lib/forecastingServerRunner";
import { saveForecastingRun } from "@/app/lib/forecastingStore";
import type { ForecastingRunMode, ProductDemandSeriesResponse } from "@/app/lib/forecastingShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const products = (body?.products || []) as ProductDemandSeriesResponse["products"];
    const trainingDays = Number(body?.trainingDays || 1095);
    const limit = Number(body?.limit || 10);
    const branch = String(body?.branch || "");
    const lookback = Number(body?.lookback || 60);
    const horizon = Number(body?.horizon || 30);
    const epochs = Number(body?.epochs || 10);
    const persist = body?.persist !== false;
    const mode: ForecastingRunMode = body?.mode === "auto" ? "auto" : "manual";

    if (!Array.isArray(products) || !products.length) {
      return NextResponse.json({ error: "Missing product demand series payload" }, { status: 400 });
    }

    const result = await runLstmForecast({
      products,
      trainingDays,
      limit,
      branch,
      lookback,
      horizon,
      epochs,
    });

    if (persist) {
      await saveForecastingRun({
        mode,
        status: "success",
        lstm: result,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/forecasting/lstm error", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run LSTM forecasting" },
      { status: 500 }
    );
  }
}
