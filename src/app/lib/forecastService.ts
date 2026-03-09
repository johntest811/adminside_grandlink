const DEFAULT_FASTAPI_URL = "http://127.0.0.1:8000";

function getForecastServiceBaseUrl() {
  return (
    process.env.FASTAPI_FORECAST_URL ||
    process.env.NEXT_PUBLIC_FASTAPI_FORECAST_URL ||
    DEFAULT_FASTAPI_URL
  ).replace(/\/$/, "");
}

export async function postForecastService<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${getForecastServiceBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json?.detail === "string" ? json.detail : json?.error;
    throw new Error(detail || `Forecast service request failed (${response.status})`);
  }

  return json as T;
}
