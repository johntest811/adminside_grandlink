export type HourlySeries = {
  times: string[]; // ISO strings
  temperature: number[];
  precipitation?: number[];
};

export type WeatherLocation = {
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export const DEFAULT_LOCATIONS: WeatherLocation[] = [
  { name: "Manila", latitude: 14.5995, longitude: 120.9842, timezone: "Asia/Manila" },
  { name: "Quezon City", latitude: 14.6760, longitude: 121.0437, timezone: "Asia/Manila" },
  { name: "Cebu", latitude: 10.3157, longitude: 123.8854, timezone: "Asia/Manila" },
  { name: "Davao", latitude: 7.1907, longitude: 125.4553, timezone: "Asia/Manila" },
];

function formatDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchHistoricalWeather(location: WeatherLocation, days = 90): Promise<HourlySeries> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - Math.max(7, Math.min(365, days)));

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("start_date", formatDate(start));
  url.searchParams.set("end_date", formatDate(end));
  url.searchParams.set("hourly", "temperature_2m,precipitation");
  url.searchParams.set("timezone", location.timezone);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const json = (await res.json()) as {
    hourly?: { time?: string[]; temperature_2m?: number[]; precipitation?: number[] };
  };

  const times = json.hourly?.time ?? [];
  const temperature = json.hourly?.temperature_2m ?? [];
  const precipitation = json.hourly?.precipitation ?? [];

  if (!times.length || times.length !== temperature.length) {
    throw new Error("Invalid weather payload");
  }

  return { times, temperature, precipitation };
}

export function trainTestSplit(series: number[], trainRatio = 0.85) {
  const n = series.length;
  const trainSize = Math.max(0, Math.min(n, Math.floor(n * trainRatio)));
  return {
    train: series.slice(0, trainSize),
    test: series.slice(trainSize),
  };
}

export function makeLaggedDataset(values: number[], lookback = 24) {
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = lookback; i < values.length; i++) {
    const window = values.slice(i - lookback, i);
    X.push(window);
    y.push(values[i]);
  }
  return { X, y };
}

export function zNormalize(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length);
  const std = Math.sqrt(variance) || 1;
  return {
    mean,
    std,
    norm: values.map((v) => (v - mean) / std),
    denorm: (v: number) => v * std + mean,
  };
}

export function mae(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
  return s / n;
}
