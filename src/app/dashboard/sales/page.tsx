"use client";

import Link from "next/link";
import React, { useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";

import { RandomForestRegression as RFRegression } from "ml-random-forest";
import {
  summarizeForecastDelta,
  trainAndForecastDailyRF,
  type SalesForecastOutput,
} from "@/app/lib/salesRandomForest";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

type SalesSeriesResponse = {
  startDate: string;
  endDate: string;
  labels: string[];
  revenue: number[];
  quantities: number[];
};

export default function SalesIndexPage() {
  const [trainingDays, setTrainingDays] = useState(180);
  const [lookback, setLookback] = useState(14);
  const [horizon, setHorizon] = useState(30);
  const [backtestDays, setBacktestDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [series, setSeries] = useState<SalesSeriesResponse | null>(null);
  const [revForecast, setRevForecast] = useState<SalesForecastOutput | null>(null);

  const run = async () => {
    try {
      setLoading(true);
      setError(null);
      setSeries(null);
      setRevForecast(null);

      const end = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - Math.max(30, Math.min(365, trainingDays)));
      const startISO = start.toISOString().slice(0, 10);
      const endISO = end.toISOString().slice(0, 10);

      const res = await fetch(`/api/analytics/sales-series?start=${startISO}&end=${endISO}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load sales series");
      const s = json as SalesSeriesResponse;
      setSeries(s);

      const rf = new RFRegression({
        nEstimators: 160,
        maxFeatures: Math.max(2, Math.floor(Math.sqrt(lookback + 3))),
        replacement: true,
        seed: 42,
      });

      const rev = await trainAndForecastDailyRF({
        rf,
        series: { labels: s.labels, values: s.revenue },
        lookback,
        horizon,
        backtestDays,
      });

      setRevForecast(rev);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!revForecast) return null;
    return {
      labels: revForecast.labels,
      datasets: [
        {
          label: "Revenue (actual)",
          data: revForecast.actual,
          borderColor: "#111827",
          backgroundColor: "rgba(17,24,39,0.15)",
          spanGaps: true,
        },
        {
          label: "Revenue (RF forecast)",
          data: revForecast.forecast,
          borderColor: "#16a34a",
          backgroundColor: "rgba(22,163,74,0.15)",
          spanGaps: true,
        },
      ],
    };
  }, [revForecast]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      plugins: {
        legend: { position: "top" as const },
        title: { display: false, text: "" },
      },
      elements: { point: { radius: 0 } },
      interaction: { mode: "index" as const, intersect: false },
    };
  }, []);

  const insight = useMemo(() => {
    if (!revForecast) return null;
    const { recentSum, futureSum, pctChange } = summarizeForecastDelta({
      actual: revForecast.actual,
      forecast: revForecast.forecast,
      horizon: revForecast.meta.horizon,
    });

    let recommendation = "Stable trend — keep current pricing/promo strategy.";
    if (pctChange <= -0.1) recommendation = "Downtrend forecast — consider promos, bundles, or review pricing.";
    if (pctChange >= 0.1) recommendation = "Uptrend forecast — consider price optimization or upsell bundles.";

    return {
      recentSum,
      futureSum,
      pctChange,
      recommendation,
    };
  }, [revForecast]);

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-black">Sales Management</h1>
            <p className="mt-1 text-sm text-gray-700">
              Create and track quotations & invoices, and use Random Forest to forecast sales trends.
            </p>
          </div>
          <div className="flex gap-2">
            <Link className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700" href="/dashboard/sales/quotations">
              Quotations
            </Link>
            <Link className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700" href="/dashboard/sales/invoices">
              Invoices
            </Link>
            <Link className="px-4 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50" href="/dashboard/sales-forecasting">
              Full Forecasting
            </Link>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-black">Sales Trend Forecast (Random Forest)</h2>
            <div className="text-sm text-gray-700">
              Uses past transactions to forecast revenue and help optimize pricing/promotions.
            </div>
          </div>
          <button
            className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            onClick={run}
            disabled={loading}
          >
            {loading ? "Training…" : "Run Trend Forecast"}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-700 mb-1">Training days</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={30}
              max={365}
              value={trainingDays}
              onChange={(e) => setTrainingDays(Number(e.target.value || 180))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Lookback</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={3}
              max={60}
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value || 14))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Horizon</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={1}
              max={90}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value || 30))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Backtest days</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={7}
              max={60}
              value={backtestDays}
              onChange={(e) => setBacktestDays(Number(e.target.value || 28))}
            />
          </div>
        </div>

        {error && <div className="text-sm text-red-700">{error}</div>}

        {series && revForecast && insight && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Range</div>
              <div className="mt-1">{series.startDate} → {series.endDate}</div>
            </div>
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Backtest MAE</div>
              <div className="mt-1">₱{Math.round(revForecast.maeBacktest).toLocaleString()}</div>
            </div>
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Pricing/Promo suggestion</div>
              <div className="mt-1">{insight.recommendation}</div>
            </div>
          </div>
        )}

        {chartData && (
          <div className="mt-3">
            <Line data={chartData} options={chartOptions as any} />
          </div>
        )}
      </div>
    </div>
  );
}
