import { patchSingletonContent, readSingletonContent } from "@/app/lib/adminSingletonContent";
import {
  coerceForecastingSettings,
  DEFAULT_FORECASTING_SETTINGS,
  type ForecastingSettings,
  type ForecastingSettingsResponse,
  type ForecastingRunMode,
  type LstmForecastBundle,
  type RandomForestForecastBundle,
} from "@/app/lib/forecastingShared";

function normalizeCache(raw: any) {
  return {
    randomForest: raw?.randomForest ?? null,
    lstm: raw?.lstm ?? null,
  } as {
    randomForest: RandomForestForecastBundle | null;
    lstm: LstmForecastBundle | null;
  };
}

export async function readForecastingState(): Promise<ForecastingSettingsResponse> {
  const { content, updatedAt } = await readSingletonContent();
  const forecasting = content?.forecasting && typeof content.forecasting === "object" ? content.forecasting : {};

  return {
    settings: coerceForecastingSettings(forecasting.settings || DEFAULT_FORECASTING_SETTINGS),
    cache: normalizeCache(forecasting.cache),
    updatedAt: forecasting.updatedAt ?? updatedAt,
  };
}

export async function updateForecastingSettings(nextSettings: Partial<ForecastingSettings>) {
  const result = await patchSingletonContent((content) => {
    const forecasting = content?.forecasting && typeof content.forecasting === "object" ? content.forecasting : {};
    const mergedSettings = {
      ...coerceForecastingSettings(forecasting.settings || DEFAULT_FORECASTING_SETTINGS),
      ...nextSettings,
    };

    return {
      ...content,
      forecasting: {
        ...forecasting,
        settings: mergedSettings,
        updatedAt: new Date().toISOString(),
      },
    };
  });

  return readForecastingState().then((state) => ({ ...state, updatedAt: result.updatedAt }));
}

export async function saveForecastingRun(params: {
  mode: ForecastingRunMode;
  status: "success" | "error";
  error?: string | null;
  randomForest?: RandomForestForecastBundle | null;
  lstm?: LstmForecastBundle | null;
}) {
  const result = await patchSingletonContent((content) => {
    const forecasting = content?.forecasting && typeof content.forecasting === "object" ? content.forecasting : {};
    const currentSettings = coerceForecastingSettings(forecasting.settings || DEFAULT_FORECASTING_SETTINGS);
    const currentCache = normalizeCache(forecasting.cache);

    return {
      ...content,
      forecasting: {
        ...forecasting,
        settings: {
          ...currentSettings,
          lastRunAt: new Date().toISOString(),
          lastRunMode: params.mode,
          lastRunStatus: params.status,
          lastRunError: params.error || null,
        },
        cache: {
          randomForest: params.randomForest === undefined ? currentCache.randomForest : params.randomForest,
          lstm: params.lstm === undefined ? currentCache.lstm : params.lstm,
        },
        updatedAt: new Date().toISOString(),
      },
    };
  });

  return readForecastingState().then((state) => ({ ...state, updatedAt: result.updatedAt }));
}
