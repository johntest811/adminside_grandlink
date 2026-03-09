export type WeatherKey = "sunny" | "rainy" | "night" | "foggy";
export type SkyboxKey = WeatherKey | "default";
export type ProductSkyboxes = Partial<Record<SkyboxKey, string | null>>;
export type GlobalSkyboxDefaults = Partial<Record<WeatherKey, string | null>>;

export const WEATHER_KEYS: WeatherKey[] = ["sunny", "rainy", "night", "foggy"];

export function createEmptyGlobalSkyboxDefaults(): GlobalSkyboxDefaults {
  return {
    sunny: null,
    rainy: null,
    night: null,
    foggy: null,
  };
}

export function normalizeSkyboxUrl(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function coerceGlobalSkyboxDefaults(input: any): GlobalSkyboxDefaults {
  const base = createEmptyGlobalSkyboxDefaults();
  for (const key of WEATHER_KEYS) {
    base[key] = normalizeSkyboxUrl(input?.[key]);
  }
  return base;
}

export function mergeEffectiveSkyboxes(
  productSkyboxes: ProductSkyboxes | null | undefined,
  globalDefaults: GlobalSkyboxDefaults | null | undefined
): ProductSkyboxes {
  const safeProduct = productSkyboxes && typeof productSkyboxes === "object" ? productSkyboxes : {};
  const safeDefaults = coerceGlobalSkyboxDefaults(globalDefaults || {});
  const legacyDefault = normalizeSkyboxUrl(safeProduct.default);

  const merged: ProductSkyboxes = legacyDefault ? { default: legacyDefault } : {};
  for (const weather of WEATHER_KEYS) {
    merged[weather] =
      normalizeSkyboxUrl(safeProduct[weather]) ||
      normalizeSkyboxUrl(safeDefaults[weather]) ||
      legacyDefault ||
      null;
  }
  return merged;
}
