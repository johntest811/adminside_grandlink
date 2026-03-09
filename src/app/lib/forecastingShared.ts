import type { SalesForecastOutput } from "@/app/lib/salesRandomForest";

export type ForecastEngineSource = "fastapi" | "fallback";
export type ForecastingRunMode = "manual" | "auto";
export type ForecastingDay =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const FORECASTING_DAY_OPTIONS: Array<{ value: ForecastingDay; label: string }> = [
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
];

export type SalesSeriesResponse = {
  startDate: string;
  endDate: string;
  labels: string[];
  revenue: number[];
  quantities: number[];
};

export type ProductDemandSeriesResponse = {
  startDate: string;
  endDate: string;
  labels: string[];
  products: Array<{
    product_id: string;
    product_name: string;
    labels: string[];
    quantities: number[];
    total_units: number;
  }>;
};

export type LstmDemandResult = {
  product_id: string;
  product_name: string;
  predicted_total_units: number;
  recent_total_units: number;
  delta_pct: number;
  mae_backtest: number;
  rmse_backtest: number;
  mape_backtest: number;
  confidence_score: number;
};

export type RandomForestSeriesForecast = SalesForecastOutput & {
  rmseBacktest: number;
  mapeBacktest: number;
  confidenceScore: number;
  trendPct: number;
  recentSum: number;
  futureSum: number;
  volatilityPct: number;
};

export type RandomForestForecastBundle = {
  trainedAt: string;
  source: ForecastEngineSource;
  series: SalesSeriesResponse;
  revenue: RandomForestSeriesForecast;
  units: RandomForestSeriesForecast;
};

export type LstmForecastBundle = {
  trainedAt: string;
  source: ForecastEngineSource;
  results: LstmDemandResult[];
  meta: {
    trainingDays: number;
    limit: number;
    branch: string;
    lookback: number;
    horizon: number;
    epochs: number;
  };
};

export type ForecastingSettings = {
  autoTrainEnabled: boolean;
  autoTrainDay: ForecastingDay;
  lastRunAt: string | null;
  lastRunMode: ForecastingRunMode | null;
  lastRunStatus: "success" | "error" | null;
  lastRunError: string | null;
};

export type ForecastingSettingsResponse = {
  settings: ForecastingSettings;
  cache: {
    randomForest: RandomForestForecastBundle | null;
    lstm: LstmForecastBundle | null;
  };
  updatedAt: string | null;
};

export const DEFAULT_FORECASTING_SETTINGS: ForecastingSettings = {
  autoTrainEnabled: false,
  autoTrainDay: "monday",
  lastRunAt: null,
  lastRunMode: null,
  lastRunStatus: null,
  lastRunError: null,
};

export function getForecastingWeekday(date: Date): ForecastingDay {
  return FORECASTING_DAY_OPTIONS[date.getUTCDay()]?.value || "monday";
}

export function getNextScheduledDate(day: ForecastingDay, fromDate = new Date()): Date {
  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);
  const targetIndex = FORECASTING_DAY_OPTIONS.findIndex((item) => item.value === day);
  const currentIndex = start.getDay();
  let delta = targetIndex - currentIndex;
  if (delta < 0) delta += 7;
  if (delta === 0 && fromDate.getTime() > start.getTime()) {
    delta = 7;
  }
  start.setDate(start.getDate() + delta);
  return start;
}

export function coerceForecastingSettings(input: any): ForecastingSettings {
  const day = String(input?.autoTrainDay || "").toLowerCase() as ForecastingDay;
  const dayIsValid = FORECASTING_DAY_OPTIONS.some((item) => item.value === day);

  return {
    autoTrainEnabled: Boolean(input?.autoTrainEnabled),
    autoTrainDay: dayIsValid ? day : DEFAULT_FORECASTING_SETTINGS.autoTrainDay,
    lastRunAt: typeof input?.lastRunAt === "string" && input.lastRunAt.trim() ? input.lastRunAt : null,
    lastRunMode: input?.lastRunMode === "manual" || input?.lastRunMode === "auto" ? input.lastRunMode : null,
    lastRunStatus: input?.lastRunStatus === "success" || input?.lastRunStatus === "error" ? input.lastRunStatus : null,
    lastRunError: typeof input?.lastRunError === "string" && input.lastRunError.trim() ? input.lastRunError : null,
  };
}
