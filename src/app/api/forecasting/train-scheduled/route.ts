import { NextRequest, NextResponse } from "next/server";
import { readForecastingState, saveForecastingRun } from "@/app/lib/forecastingStore";
import { getForecastingWeekday } from "@/app/lib/forecastingShared";
import { runLstmForecast, runRandomForestForecast } from "@/app/lib/forecastingServerRunner";
import type { ProductDemandSeriesResponse, SalesSeriesResponse } from "@/app/lib/forecastingShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function isAuthorized(request: NextRequest) {
  const cronHeader = request.headers.get("x-vercel-cron");
  if (cronHeader) return true;

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";

  const authHeader = request.headers.get("authorization") || "";
  return authHeader === `Bearer ${secret}`;
}

function getBaseUrl(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function sameUtcDate(a: string | null, b: Date) {
  if (!a) return false;
  const left = new Date(a);
  return left.getUTCFullYear() === b.getUTCFullYear()
    && left.getUTCMonth() === b.getUTCMonth()
    && left.getUTCDate() === b.getUTCDate();
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const state = await readForecastingState();
    const today = new Date();
    const todayKey = getForecastingWeekday(today);

    if (!state.settings.autoTrainEnabled) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Automatic training is disabled" });
    }

    if (state.settings.autoTrainDay !== todayKey) {
      return NextResponse.json({ ok: true, skipped: true, reason: `Scheduled for ${state.settings.autoTrainDay}` });
    }

    if (sameUtcDate(state.settings.lastRunAt, today)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Already trained today" });
    }

    const baseUrl = getBaseUrl(request);
    const [salesResponse, productResponse] = await Promise.all([
      fetch(`${baseUrl}/api/analytics/sales-series`, { cache: "no-store" }),
      fetch(`${baseUrl}/api/analytics/product-demand-series?days=1095&limit=10`, { cache: "no-store" }),
    ]);

    if (!salesResponse.ok) {
      throw new Error(`Failed to load sales series (${salesResponse.status})`);
    }
    if (!productResponse.ok) {
      throw new Error(`Failed to load product demand series (${productResponse.status})`);
    }

    const salesSeries = (await salesResponse.json()) as SalesSeriesResponse;
    const productSeries = (await productResponse.json()) as ProductDemandSeriesResponse;

    const [randomForest, lstm] = await Promise.all([
      runRandomForestForecast({
        series: salesSeries,
        lookback: 14,
        horizon: 30,
        backtestDays: 28,
      }),
      runLstmForecast({
        products: productSeries.products,
        trainingDays: 1095,
        limit: 10,
        branch: "",
        lookback: 60,
        horizon: 30,
        epochs: 10,
      }),
    ]);

    const nextState = await saveForecastingRun({
      mode: "auto",
      status: "success",
      randomForest,
      lstm,
    });

    return NextResponse.json({
      ok: true,
      skipped: false,
      trainedAt: nextState.settings.lastRunAt,
      randomForestSource: randomForest.source,
      lstmSource: lstm.source,
    });
  } catch (error) {
    console.error("GET /api/forecasting/train-scheduled error", error);
    await saveForecastingRun({
      mode: "auto",
      status: "error",
      error: error instanceof Error ? error.message : "Scheduled training failed",
    }).catch(() => undefined);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Scheduled training failed" },
      { status: 500 }
    );
  }
}
