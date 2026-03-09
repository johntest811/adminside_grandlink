import { RandomForestRegression as RFRegression } from "ml-random-forest";
import { summarizeForecastDelta, trainAndForecastDailyRF } from "@/app/lib/salesRandomForest";
import { trainAndForecastDemandLSTM } from "@/app/lib/salesLstmForecast";
import type {
  LstmDemandResult,
  LstmForecastBundle,
  ProductDemandSeriesResponse,
  RandomForestForecastBundle,
  RandomForestSeriesForecast,
  SalesSeriesResponse,
} from "@/app/lib/forecastingShared";

function computeRegressionMetrics(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  if (!n) {
    return {
      mae: 0,
      rmse: 0,
      mape: 0,
    };
  }

  let absErrorSum = 0;
  let squaredErrorSum = 0;
  let pctErrorSum = 0;
  let pctCount = 0;

  for (let index = 0; index < n; index += 1) {
    const actualValue = Number(actual[index] || 0);
    const predictedValue = Number(predicted[index] || 0);
    const error = predictedValue - actualValue;

    absErrorSum += Math.abs(error);
    squaredErrorSum += error * error;

    if (Math.abs(actualValue) > 1e-6) {
      pctErrorSum += Math.abs(error) / Math.abs(actualValue);
      pctCount += 1;
    }
  }

  return {
    mae: absErrorSum / n,
    rmse: Math.sqrt(squaredErrorSum / n),
    mape: pctCount > 0 ? (pctErrorSum / pctCount) * 100 : 0,
  };
}

function buildConfidenceScore(opts: { mae: number; mape: number; forecast: number[]; horizon: number }) {
  const futureValues = opts.forecast
    .slice(Math.max(0, opts.forecast.length - opts.horizon))
    .filter((value) => Number.isFinite(value));
  const futureMean = futureValues.length
    ? futureValues.reduce((sum, value) => sum + value, 0) / futureValues.length
    : 0;
  const futureVariance = futureValues.length > 1
    ? futureValues.reduce((sum, value) => sum + (value - futureMean) ** 2, 0) / (futureValues.length - 1)
    : 0;
  const volatilityPct = futureMean > 0 ? (Math.sqrt(futureVariance) / futureMean) * 100 : 0;
  const errorRatio = opts.mae / Math.max(1, futureMean || 1);
  const confidenceScore = Math.max(5, Math.min(99, 100 - opts.mape * 0.75 - errorRatio * 60 - volatilityPct * 0.18));

  return {
    confidenceScore,
    volatilityPct,
  };
}

function augmentForecast(seriesForecast: any): RandomForestSeriesForecast {
  const actualOverlap: number[] = [];
  const forecastOverlap: number[] = [];
  for (let index = 0; index < seriesForecast.actual.length; index += 1) {
    const actualValue = seriesForecast.actual[index];
    const forecastValue = seriesForecast.forecast[index];
    if (Number.isFinite(actualValue) && Number.isFinite(forecastValue)) {
      actualOverlap.push(Number(actualValue));
      forecastOverlap.push(Number(forecastValue));
    }
  }

  const metrics = computeRegressionMetrics(actualOverlap, forecastOverlap);
  const delta = summarizeForecastDelta({
    actual: seriesForecast.actual,
    forecast: seriesForecast.forecast,
    horizon: seriesForecast.meta.horizon,
  });
  const confidence = buildConfidenceScore({
    mae: metrics.mae,
    mape: metrics.mape,
    forecast: seriesForecast.forecast,
    horizon: seriesForecast.meta.horizon,
  });

  return {
    ...seriesForecast,
    rmseBacktest: metrics.rmse,
    mapeBacktest: metrics.mape,
    confidenceScore: confidence.confidenceScore,
    trendPct: delta.pctChange * 100,
    recentSum: delta.recentSum,
    futureSum: delta.futureSum,
    volatilityPct: confidence.volatilityPct,
  };
}

async function callFastApi<T>(path: string, payload: Record<string, unknown>): Promise<T | null> {
  const baseUrl = process.env.FORECASTING_FASTAPI_URL?.trim();
  if (!baseUrl) return null;

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(errorBody || `FastAPI request failed (${response.status})`);
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(`FastAPI ${path} failed, falling back to local forecasting`, error);
    return null;
  }
}

export async function runRandomForestForecast(params: {
  series: SalesSeriesResponse;
  lookback: number;
  horizon: number;
  backtestDays: number;
}): Promise<RandomForestForecastBundle> {
  const fastApiResult = await callFastApi<RandomForestForecastBundle>("/forecast/random-forest", {
    series: params.series,
    lookback: params.lookback,
    horizon: params.horizon,
    backtestDays: params.backtestDays,
  });

  if (fastApiResult) {
    return {
      ...fastApiResult,
      source: "fastapi",
      trainedAt: fastApiResult.trainedAt || new Date().toISOString(),
    };
  }

  const revenueRf = new RFRegression({
    nEstimators: 160,
    maxFeatures: Math.max(2, Math.floor(Math.sqrt(params.lookback + 3))),
    replacement: true,
    seed: 42,
  });
  const unitsRf = new RFRegression({
    nEstimators: 160,
    maxFeatures: Math.max(2, Math.floor(Math.sqrt(params.lookback + 3))),
    replacement: true,
    seed: 42,
  });

  const revenueForecast = await trainAndForecastDailyRF({
    rf: revenueRf,
    series: { labels: params.series.labels, values: params.series.revenue },
    lookback: params.lookback,
    horizon: params.horizon,
    backtestDays: params.backtestDays,
  });

  const unitsForecast = await trainAndForecastDailyRF({
    rf: unitsRf,
    series: { labels: params.series.labels, values: params.series.quantities },
    lookback: params.lookback,
    horizon: params.horizon,
    backtestDays: params.backtestDays,
  });

  return {
    trainedAt: new Date().toISOString(),
    source: "fallback",
    series: params.series,
    revenue: augmentForecast(revenueForecast),
    units: augmentForecast(unitsForecast),
  };
}

export async function runLstmForecast(params: {
  products: ProductDemandSeriesResponse["products"];
  trainingDays: number;
  limit: number;
  branch: string;
  lookback: number;
  horizon: number;
  epochs: number;
}): Promise<LstmForecastBundle> {
  const fastApiResult = await callFastApi<LstmForecastBundle>("/forecast/lstm", {
    products: params.products,
    trainingDays: params.trainingDays,
    limit: params.limit,
    branch: params.branch,
    lookback: params.lookback,
    horizon: params.horizon,
    epochs: params.epochs,
  });

  if (fastApiResult) {
    return {
      ...fastApiResult,
      source: "fastapi",
      trainedAt: fastApiResult.trainedAt || new Date().toISOString(),
    };
  }

  const selectedProducts = (params.products || []).slice(0, Math.min(12, Math.max(3, params.limit)));
  const results: LstmDemandResult[] = [];
  const skippedErrors: string[] = [];

  for (const product of selectedProducts) {
    try {
      const forecast = await trainAndForecastDemandLSTM({
        labels: product.labels,
        quantities: product.quantities,
        lookback: params.lookback,
        horizon: params.horizon,
        epochs: params.epochs,
      });
      const delta = forecast.recent_total > 0
        ? (forecast.predicted_total - forecast.recent_total) / forecast.recent_total
        : 0;

      results.push({
        product_id: product.product_id,
        product_name: product.product_name,
        predicted_total_units: forecast.predicted_total,
        recent_total_units: forecast.recent_total,
        delta_pct: delta,
        mae_backtest: forecast.mae_backtest,
        rmse_backtest: forecast.rmse_backtest,
        mape_backtest: forecast.mape_backtest,
        confidence_score: forecast.confidence_score,
      });
    } catch (error) {
      skippedErrors.push(`${product.product_name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!results.length) {
    throw new Error(skippedErrors[0] || "Unable to train LSTM forecast for the selected products");
  }

  results.sort((a, b) => b.predicted_total_units - a.predicted_total_units);

  return {
    trainedAt: new Date().toISOString(),
    source: "fallback",
    results,
    meta: {
      trainingDays: params.trainingDays,
      limit: params.limit,
      branch: params.branch,
      lookback: params.lookback,
      horizon: params.horizon,
      epochs: params.epochs,
    },
  };
}
