"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import {
  summarizeForecastDelta,
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

type ProductDemandSeriesResponse = {
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

const FIXED_TRAINING_DAYS = 1095;

type LstmDemandResult = {
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

type RandomForestResponse = {
  revenue: SalesForecastOutput;
  units: SalesForecastOutput;
};

type ForecastingSettings = {
  autoTrainEnabled: boolean;
  autoTrainDay: number;
  lastAutoTrainAt: string | null;
};

const FORECASTING_DAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getNextScheduledRunLabel(dayOfWeek: number) {
  const now = new Date();
  const target = new Date(now);
  const diff = (dayOfWeek - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + diff);
  if (diff === 0) {
    return `Today (${target.toLocaleDateString()})`;
  }
  return target.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function computeRegressionMetrics(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  if (!n) {
    return {
      mae: 0,
      rmse: 0,
      mape: 0,
      bias: 0,
      sampleSize: 0,
    };
  }

  let absErrorSum = 0;
  let squaredErrorSum = 0;
  let pctErrorSum = 0;
  let pctCount = 0;
  let biasSum = 0;

  for (let index = 0; index < n; index += 1) {
    const actualValue = Number(actual[index] || 0);
    const predictedValue = Number(predicted[index] || 0);
    const error = predictedValue - actualValue;

    absErrorSum += Math.abs(error);
    squaredErrorSum += error * error;
    biasSum += error;

    if (Math.abs(actualValue) > 1e-6) {
      pctErrorSum += Math.abs(error) / Math.abs(actualValue);
      pctCount += 1;
    }
  }

  return {
    mae: absErrorSum / n,
    rmse: Math.sqrt(squaredErrorSum / n),
    mape: pctCount > 0 ? (pctErrorSum / pctCount) * 100 : 0,
    bias: biasSum / n,
    sampleSize: n,
  };
}

export default function SalesForecastingPage() {
  const trainingDays = FIXED_TRAINING_DAYS;
  const [lookback, setLookback] = useState(14);
  const [horizon, setHorizon] = useState(30);
  const [backtestDays, setBacktestDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<SalesSeriesResponse | null>(null);
  const [revForecast, setRevForecast] = useState<SalesForecastOutput | null>(null);
  const [qtyForecast, setQtyForecast] = useState<SalesForecastOutput | null>(null);

  const revChartRef = useRef<any>(null);
  const qtyChartRef = useRef<any>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [autoRunDone, setAutoRunDone] = useState(false);

  // LSTM: product demand forecasting
  const lstmDays = FIXED_TRAINING_DAYS;
  const [lstmLimit, setLstmLimit] = useState(10);
  const [lstmBranch, setLstmBranch] = useState<string>("");
  const [lstmLookback, setLstmLookback] = useState(60);
  const [lstmHorizon, setLstmHorizon] = useState(30);
  const [lstmEpochs, setLstmEpochs] = useState(10);
  const [lstmLoading, setLstmLoading] = useState(false);
  const [lstmError, setLstmError] = useState<string | null>(null);
  const [lstmResults, setLstmResults] = useState<LstmDemandResult[] | null>(null);
  const [lstmLastRunAt, setLstmLastRunAt] = useState<string | null>(null);
  const [forecastSettings, setForecastSettings] = useState<ForecastingSettings>({
    autoTrainEnabled: false,
    autoTrainDay: 1,
    lastAutoTrainAt: null,
  });
  const [forecastSettingsLoading, setForecastSettingsLoading] = useState(true);
  const [forecastSettingsSaving, setForecastSettingsSaving] = useState(false);
  const [autoTraining, setAutoTraining] = useState(false);

  const [lstmProgress, setLstmProgress] = useState<{ current: number; total: number; label: string } | null>(null);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setSeries(null);
      setRevForecast(null);
      setQtyForecast(null);

      const end = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - FIXED_TRAINING_DAYS);
      const startISO = start.toISOString().slice(0, 10);
      const endISO = end.toISOString().slice(0, 10);

      const res = await fetch(`/api/analytics/sales-series?start=${startISO}&end=${endISO}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load sales series");
      const s = json as SalesSeriesResponse;
      setSeries(s);

      const forecastRes = await fetch("/api/forecasting/random-forest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series: s,
          lookback,
          horizon,
          backtestDays,
        }),
      });
      const forecastJson = (await forecastRes.json().catch(() => ({}))) as any;
      if (!forecastRes.ok) throw new Error(forecastJson?.error || "Failed to run Random Forest forecast");

      const forecastPayload = forecastJson as RandomForestResponse;
      setRevForecast(forecastPayload.revenue);
      setQtyForecast(forecastPayload.units);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [backtestDays, horizon, lookback]);

  const revenueChartData = useMemo(() => {
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

  const qtyChartData = useMemo(() => {
    if (!qtyForecast) return null;
    return {
      labels: qtyForecast.labels,
      datasets: [
        {
          label: "Units (actual)",
          data: qtyForecast.actual,
          borderColor: "#111827",
          backgroundColor: "rgba(17,24,39,0.15)",
          spanGaps: true,
        },
        {
          label: "Units (RF forecast)",
          data: qtyForecast.forecast,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.15)",
          spanGaps: true,
        },
      ],
    };
  }, [qtyForecast]);

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

  const rfAnalytics = useMemo(() => {
    if (!revForecast || !qtyForecast) return null;

    const buildSeriesAnalytics = (forecast: SalesForecastOutput) => {
      const actualOverlap: number[] = [];
      const forecastOverlap: number[] = [];
      for (let index = 0; index < forecast.actual.length; index += 1) {
        const actualValue = forecast.actual[index];
        const forecastValue = forecast.forecast[index];
        if (Number.isFinite(actualValue) && Number.isFinite(forecastValue)) {
          actualOverlap.push(Number(actualValue));
          forecastOverlap.push(Number(forecastValue));
        }
      }

      const metrics = computeRegressionMetrics(actualOverlap, forecastOverlap);
      const delta = summarizeForecastDelta({
        actual: forecast.actual,
        forecast: forecast.forecast,
        horizon: forecast.meta.horizon,
      });

      const futureValues = forecast.forecast
        .slice(Math.max(0, forecast.forecast.length - forecast.meta.horizon))
        .filter((value): value is number => Number.isFinite(value));
      const futureMean = futureValues.length
        ? futureValues.reduce((sum, value) => sum + value, 0) / futureValues.length
        : 0;
      const futureVariance = futureValues.length > 1
        ? futureValues.reduce((sum, value) => sum + (value - futureMean) ** 2, 0) / (futureValues.length - 1)
        : 0;
      const volatilityPct = futureMean > 0 ? (Math.sqrt(futureVariance) / futureMean) * 100 : 0;

      return {
        ...metrics,
        trendPct: delta.pctChange * 100,
        recentSum: delta.recentSum,
        futureSum: delta.futureSum,
        volatilityPct,
      };
    };

    return {
      revenue: buildSeriesAnalytics(revForecast),
      units: buildSeriesAnalytics(qtyForecast),
    };
  }, [qtyForecast, revForecast]);

  const lstmAnalytics = useMemo(() => {
    if (!lstmResults || lstmResults.length === 0) return null;

    const count = lstmResults.length;
    const risingCount = lstmResults.filter((result) => result.delta_pct >= 0).length;
    const avgDeltaPct =
      lstmResults.reduce((sum, result) => sum + result.delta_pct, 0) / count;
    const avgMae =
      lstmResults.reduce((sum, result) => sum + result.mae_backtest, 0) / count;
    const avgRmse =
      lstmResults.reduce((sum, result) => sum + result.rmse_backtest, 0) / count;
    const avgMape =
      lstmResults.reduce((sum, result) => sum + result.mape_backtest, 0) / count;
    const avgConfidence =
      lstmResults.reduce((sum, result) => sum + result.confidence_score, 0) / count;

    const strongestGrowth = [...lstmResults].sort((a, b) => b.delta_pct - a.delta_pct)[0];
    const weakestGrowth = [...lstmResults].sort((a, b) => a.delta_pct - b.delta_pct)[0];

    return {
      count,
      risingCount,
      avgDeltaPct,
      avgMae,
      avgRmse,
      avgMape,
      avgConfidence,
      strongestGrowth,
      weakestGrowth,
    };
  }, [lstmResults]);

  const runLstm = useCallback(async (trigger: "manual" | "auto" = "manual") => {
    try {
      setLstmLoading(true);
      setLstmError(null);
      setLstmResults(null);
      setLstmProgress({ current: 0, total: 1, label: "Preparing demand series…" });

      const branchParam = lstmBranch.trim() ? `&branch=${encodeURIComponent(lstmBranch.trim())}` : "";
      const res = await fetch(
        `/api/analytics/product-demand-series?days=${FIXED_TRAINING_DAYS}&limit=${lstmLimit}${branchParam}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load product demand series");
      const data = json as ProductDemandSeriesResponse;
      const autoMode = trigger === "auto";
      const effectiveLimit = Math.min(autoMode ? 6 : 12, lstmLimit);
      const products = (data.products || []).slice(0, effectiveLimit);
      setLstmProgress({ current: 1, total: 1, label: `Training LSTM in FastAPI for ${products.length} product(s)…` });

      const lstmRes = await fetch("/api/forecasting/lstm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products,
          lookback: lstmLookback,
          horizon: lstmHorizon,
          epochs: lstmEpochs,
          limit: effectiveLimit,
          autoMode,
        }),
      });
      const lstmJson = (await lstmRes.json().catch(() => ({}))) as any;
      if (!lstmRes.ok) throw new Error(lstmJson?.error || "Failed to run LSTM demand forecast");

      setLstmResults(Array.isArray(lstmJson?.results) ? lstmJson.results : []);
      setLstmLastRunAt(new Date().toISOString());
    } catch (e: unknown) {
      setLstmError(e instanceof Error ? e.message : String(e));
    } finally {
      setLstmProgress(null);
      setLstmLoading(false);
    }
  }, [lstmBranch, lstmEpochs, lstmHorizon, lstmLimit, lstmLookback]);

  useEffect(() => {
    if (autoRunDone) return;
    setAutoRunDone(true);
    void run();
  }, [autoRunDone, run]);

  useEffect(() => {
    const loadForecastSettings = async () => {
      try {
        setForecastSettingsLoading(true);
        const res = await fetch("/api/forecasting/settings", { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load forecasting settings");
        setForecastSettings((json?.settings || {}) as ForecastingSettings);
      } catch (e) {
        console.error("Failed to load forecasting settings", e);
      } finally {
        setForecastSettingsLoading(false);
      }
    };

    void loadForecastSettings();
  }, []);

  const saveForecastSettings = useCallback(async (nextSettings: ForecastingSettings) => {
    setForecastSettingsSaving(true);
    try {
      const res = await fetch("/api/forecasting/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextSettings }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to save forecasting settings");
      const saved = (json?.settings || nextSettings) as ForecastingSettings;
      setForecastSettings(saved);
      return saved;
    } finally {
      setForecastSettingsSaving(false);
    }
  }, []);

  const runScheduledTraining = useCallback(async () => {
    if (autoTraining || loading || lstmLoading) return;
    setAutoTraining(true);
    try {
      await run();
      await runLstm("auto");
      const nextStamp = new Date().toISOString();
      await saveForecastSettings({
        ...forecastSettings,
        lastAutoTrainAt: nextStamp,
      });
    } finally {
      setAutoTraining(false);
    }
  }, [autoTraining, forecastSettings, loading, lstmLoading, run, runLstm, saveForecastSettings]);

  const shouldRunAutoTraining = useCallback(() => {
    if (!forecastSettings.autoTrainEnabled) return false;
    const now = new Date();
    if (now.getDay() !== forecastSettings.autoTrainDay) return false;
    if (!forecastSettings.lastAutoTrainAt) return true;
    return !isSameLocalDay(now, new Date(forecastSettings.lastAutoTrainAt));
  }, [forecastSettings]);

  useEffect(() => {
    if (forecastSettingsLoading) return;

    const checkSchedule = () => {
      if (shouldRunAutoTraining()) {
        void runScheduledTraining();
      }
    };

    checkSchedule();
    const timer = window.setInterval(checkSchedule, 60_000);
    return () => window.clearInterval(timer);
  }, [forecastSettingsLoading, runScheduledTraining, shouldRunAutoTraining]);

  const runLstmNow = useCallback(async () => {
    await runLstm("manual");
  }, [runLstm]);

  const exportPdf = useCallback(async () => {
    try {
      setPdfLoading(true);

      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const now = new Date();
      const fileDate = now.toISOString().slice(0, 10);

      const pageWidth = (pdf as any).internal.pageSize.getWidth();
      const marginX = 14;
      let y = 16;

      pdf.setFontSize(16);
      pdf.setTextColor(17, 24, 39);
      pdf.text("Sales Forecasting & Demand Report", marginX, y);
      y += 7;

      pdf.setFontSize(10);
      pdf.setTextColor(75, 85, 99);
      pdf.text(`Generated: ${now.toLocaleString()}`, marginX, y);
      y += 8;

      // Summary table (RF forecast)
      const revDelta = revForecast
        ? summarizeForecastDelta({ actual: revForecast.actual, forecast: revForecast.forecast, horizon: revForecast.meta.horizon })
        : null;
      const qtyDelta = qtyForecast
        ? summarizeForecastDelta({ actual: qtyForecast.actual, forecast: qtyForecast.forecast, horizon: qtyForecast.meta.horizon })
        : null;

      autoTable(pdf, {
        startY: y,
        head: [["Section", "Notes"]],
        body: [
          [
            "Random Forest (Sales)",
            series && revForecast && qtyForecast
              ? `Range: ${series.startDate} → ${series.endDate}. Revenue MAE: ₱${Math.round(revForecast.maeBacktest).toLocaleString()}. Units MAE: ${qtyForecast.maeBacktest.toFixed(2)}.`
              : "Not run / no data.",
          ],
          [
            "RF Trend (Next Horizon)",
            revDelta && qtyDelta
              ? `Revenue: ${(revDelta.pctChange * 100).toFixed(1)}% vs recent horizon. Units: ${(qtyDelta.pctChange * 100).toFixed(1)}% vs recent horizon.`
              : "Not available.",
          ],
          [
            "LSTM Demand (Top Products)",
            lstmResults?.length
              ? `History: ${lstmDays}d, horizon: ${lstmHorizon}d, lookback: ${lstmLookback}, epochs: ${lstmEpochs}. Branch: ${lstmBranch.trim() || "all"}.`
              : "Not run / no data.",
          ],
        ],
        theme: "striped",
        headStyles: { fillColor: [17, 24, 39] },
        styles: { fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });

      y = ((pdf as any).lastAutoTable?.finalY || y) + 8;

      // Add charts as images when available
      const getChartPng = (ref: any): string | null => {
        const inst = ref?.current?.chart ?? ref?.current;
        const toBase64 = inst?.toBase64Image;
        if (typeof toBase64 === "function") return toBase64.call(inst);
        return null;
      };

      const revImg = getChartPng(revChartRef);
      const qtyImg = getChartPng(qtyChartRef);
      const imgW = pageWidth - marginX * 2;
      const imgH = 70;

      if (revImg) {
        if (y + imgH > 285) {
          pdf.addPage();
          y = 16;
        }
        pdf.setFontSize(12);
        pdf.setTextColor(17, 24, 39);
        pdf.text("Revenue Forecast", marginX, y);
        y += 4;
        pdf.addImage(revImg, "PNG", marginX, y, imgW, imgH);
        y += imgH + 10;
      }

      if (qtyImg) {
        if (y + imgH > 285) {
          pdf.addPage();
          y = 16;
        }
        pdf.setFontSize(12);
        pdf.setTextColor(17, 24, 39);
        pdf.text("Units Forecast", marginX, y);
        y += 4;
        pdf.addImage(qtyImg, "PNG", marginX, y, imgW, imgH);
        y += imgH + 8;
      }

      // LSTM table
      if (y > 265) {
        pdf.addPage();
        y = 16;
      }

      pdf.setFontSize(12);
      pdf.setTextColor(17, 24, 39);
      pdf.text("LSTM Product Demand (Top Products)", marginX, y);
      y += 4;

      autoTable(pdf, {
        startY: y,
        head: [["Product", "Predicted (next)", "Recent (last)", "Δ%"]],
        body: (lstmResults || []).map((r) => [
          r.product_name,
          Math.round(r.predicted_total_units).toLocaleString(),
          Math.round(r.recent_total_units).toLocaleString(),
          `${(r.delta_pct * 100).toFixed(1)}%`,
        ]),
        theme: "striped",
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });

      pdf.save(`sales-forecast-demand-${fileDate}.pdf`);
    } catch (e) {
      console.error("PDF export failed", e);
      alert(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setPdfLoading(false);
    }
  }, [lstmBranch, lstmDays, lstmEpochs, lstmHorizon, lstmLookback, lstmResults, qtyForecast, revForecast, series]);

  const syncSalesInventory9Months = async () => {
    try {
      setSyncLoading(true);
      setSyncMessage(null);
      const res = await fetch(`/api/analytics/sales-inventory-9months?months=36`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to build sales_inventory_data");
      setSyncMessage(`Upserted ${json?.rowsUpserted || 0} rows into sales_inventory_data`);
    } catch (e: unknown) {
      setSyncMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-black">Sales Forecasting</h1>
            <p className="mt-2 text-black text-sm">
              FastAPI-backed Random Forest and LSTM forecasting trained on daily sales data from <span className="font-mono">/api/analytics</span>.
            </p>
          </div>
          <button
            className="px-3 py-2 rounded bg-black text-white hover:bg-gray-900 disabled:opacity-50"
            onClick={exportPdf}
            disabled={pdfLoading || loading || lstmLoading}
            title={loading || lstmLoading ? "Wait for training to finish" : "Download PDF"}
          >
            {pdfLoading ? "Generating PDF…" : "Export PDF"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="px-3 py-2 rounded bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            onClick={syncSalesInventory9Months}
            disabled={syncLoading}
          >
            {syncLoading ? "Syncing…" : "Sync sales_inventory_data (3 years)"}
          </button>
          {syncMessage && <div className="text-sm text-gray-700">{syncMessage}</div>}
          <div className="text-xs text-gray-500">
            Requires running <span className="font-mono">SUPABASE_SALES_INVENTORY_DATA.sql</span> in Supabase.
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-700 mb-1">Training window</label>
            <div className="w-full px-3 py-2 border rounded bg-gray-50 text-black text-sm">
              Fixed at 3 years ({trainingDays} days)
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Lookback (days)</label>
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
            <label className="block text-xs text-gray-700 mb-1">Forecast horizon</label>
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
          <div className="flex items-end">
            <button
              className="w-full px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              onClick={run}
              disabled={loading}
            >
              {loading ? "Training…" : "Run Forecast"}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 text-sm text-red-700">{error}</div>}

        {series && revForecast && qtyForecast && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Range</div>
              <div className="mt-1">{series.startDate} → {series.endDate}</div>
            </div>
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Revenue MAE (backtest)</div>
              <div className="mt-1">₱{Math.round(revForecast.maeBacktest).toLocaleString()}</div>
            </div>
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Units MAE (backtest)</div>
              <div className="mt-1">{qtyForecast.maeBacktest.toFixed(2)}</div>
            </div>
          </div>
        )}

        {rfAnalytics && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm">
            <div className="p-3 rounded border bg-indigo-50 text-black">
              <div className="font-semibold">Revenue RMSE / MAPE</div>
              <div className="mt-1">₱{Math.round(rfAnalytics.revenue.rmse).toLocaleString()} / {rfAnalytics.revenue.mape.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-blue-50 text-black">
              <div className="font-semibold">Units RMSE / MAPE</div>
              <div className="mt-1">{rfAnalytics.units.rmse.toFixed(2)} / {rfAnalytics.units.mape.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-violet-50 text-black">
              <div className="font-semibold">Model Confidence</div>
              <div className="mt-1">Revenue {revForecast?.confidenceScore.toFixed(0) || "0"}/100 · Units {qtyForecast?.confidenceScore.toFixed(0) || "0"}/100</div>
            </div>
            <div className="p-3 rounded border bg-green-50 text-black">
              <div className="font-semibold">Forecast Trend (horizon)</div>
              <div className="mt-1">
                Revenue <span className={rfAnalytics.revenue.trendPct >= 0 ? "text-green-700" : "text-red-700"}>{rfAnalytics.revenue.trendPct.toFixed(1)}%</span> · Units <span className={rfAnalytics.units.trendPct >= 0 ? "text-green-700" : "text-red-700"}>{rfAnalytics.units.trendPct.toFixed(1)}%</span>
              </div>
            </div>
            <div className="p-3 rounded border bg-amber-50 text-black">
              <div className="font-semibold">Forecast Volatility</div>
              <div className="mt-1">Revenue {rfAnalytics.revenue.volatilityPct.toFixed(1)}% · Units {rfAnalytics.units.volatilityPct.toFixed(1)}%</div>
            </div>
          </div>
        )}
      </div>

      {revenueChartData && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-black">Revenue Forecast</h2>
            {revForecast && (
              <div className="text-xs text-gray-600">
                trainSamples={revForecast.meta.trainSamples} · lookback={revForecast.meta.lookback} · horizon={revForecast.meta.horizon}
              </div>
            )}
          </div>
          <div className="mt-4">
            <Line ref={revChartRef} data={revenueChartData} options={chartOptions as any} />
          </div>
        </div>
      )}

      {qtyChartData && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-black">Units Forecast</h2>
            {qtyForecast && (
              <div className="text-xs text-gray-600">
                trainSamples={qtyForecast.meta.trainSamples} · lookback={qtyForecast.meta.lookback} · horizon={qtyForecast.meta.horizon}
              </div>
            )}
          </div>
          <div className="mt-4">
            <Line ref={qtyChartRef} data={qtyChartData} options={chartOptions as any} />
          </div>
        </div>
      )}

      <div className="bg-white shadow rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-black">LSTM Product Demand (Top Products)</h2>
            <p className="text-sm text-gray-700 mt-1">
              Predicts which products are likely to be in higher demand next, using an LSTM trained on daily units sold.
              Includes seasonality via month features; optional branch filter uses delivery address branch.
            </p>
          </div>
          <button
            className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={() => void runLstmNow()}
            disabled={lstmLoading}
          >
            {lstmLoading ? "Training…" : "Run LSTM Ranking"}
          </button>
        </div>

        <div className="rounded border bg-gray-50 p-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={forecastSettings.autoTrainEnabled}
                onChange={(e) =>
                  setForecastSettings((prev) => ({
                    ...prev,
                    autoTrainEnabled: e.target.checked,
                  }))
                }
              />
              Enable automatic FastAPI training
            </label>
            <div>
              <label className="block text-xs text-gray-700 mb-1">Auto-train day</label>
              <select
                className="w-full px-3 py-2 border rounded text-black bg-white"
                value={forecastSettings.autoTrainDay}
                disabled={!forecastSettings.autoTrainEnabled}
                onChange={(e) =>
                  setForecastSettings((prev) => ({
                    ...prev,
                    autoTrainDay: Number(e.target.value || 1),
                  }))
                }
              >
                {FORECASTING_DAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-gray-700 flex flex-col justify-center">
              <div>
                Last automatic run: {forecastSettings.lastAutoTrainAt ? new Date(forecastSettings.lastAutoTrainAt).toLocaleString() : "Not yet"}
              </div>
              <div>
                Next scheduled day: {forecastSettings.autoTrainEnabled ? getNextScheduledRunLabel(forecastSettings.autoTrainDay) : "Disabled"}
              </div>
            </div>
            <div className="flex items-end justify-start md:justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded border border-indigo-300 bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-50"
                onClick={() => void saveForecastSettings(forecastSettings)}
                disabled={forecastSettingsSaving || forecastSettingsLoading}
              >
                {forecastSettingsSaving ? "Saving…" : "Save auto-train day"}
              </button>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-600">
            The scheduled run automatically triggers both FastAPI models on the selected day while this dashboard is active.
            {lstmLastRunAt ? ` Last LSTM run: ${new Date(lstmLastRunAt).toLocaleString()}.` : ""}
            {autoTraining ? " Running scheduled training now…" : ""}
          </div>
        </div>

        {lstmProgress && (
          <div className="rounded border bg-gray-50 p-3">
            <div className="text-sm text-gray-800">
              {lstmProgress.label} ({lstmProgress.current}/{lstmProgress.total})
            </div>
            <div className="mt-2 h-2 w-full rounded bg-gray-200 overflow-hidden">
              <div
                className="h-2 bg-indigo-600"
                style={{ width: `${lstmProgress.total ? (lstmProgress.current / lstmProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs text-gray-700 mb-1">History window</label>
            <div className="w-full px-3 py-2 border rounded bg-gray-50 text-black text-sm">
              Fixed at 3 years ({lstmDays} days)
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Products (top)</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={3}
              max={20}
              value={lstmLimit}
              onChange={(e) => setLstmLimit(Number(e.target.value || 10))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Branch (optional)</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              placeholder="e.g. Main"
              value={lstmBranch}
              onChange={(e) => setLstmBranch(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Lookback</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={14}
              max={120}
              value={lstmLookback}
              onChange={(e) => setLstmLookback(Number(e.target.value || 60))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Horizon</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={7}
              max={90}
              value={lstmHorizon}
              onChange={(e) => setLstmHorizon(Number(e.target.value || 30))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Epochs</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={4}
              max={30}
              value={lstmEpochs}
              onChange={(e) => setLstmEpochs(Number(e.target.value || 10))}
            />
          </div>
        </div>

        {lstmError && <div className="text-sm text-red-700">{lstmError}</div>}

        {lstmAnalytics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Avg LSTM Error</div>
              <div className="mt-1">MAE {lstmAnalytics.avgMae.toFixed(2)} · RMSE {lstmAnalytics.avgRmse.toFixed(2)} · MAPE {lstmAnalytics.avgMape.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-indigo-50 text-black">
              <div className="font-semibold">Avg Confidence</div>
              <div className="mt-1">{lstmAnalytics.avgConfidence.toFixed(1)} / 100</div>
            </div>
            <div className="p-3 rounded border bg-green-50 text-black">
              <div className="font-semibold">Demand Direction</div>
              <div className="mt-1">{lstmAnalytics.risingCount}/{lstmAnalytics.count} products rising · Avg Δ { (lstmAnalytics.avgDeltaPct * 100).toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-amber-50 text-black">
              <div className="font-semibold">Outlier Watch</div>
              <div className="mt-1">
                ↑ {lstmAnalytics.strongestGrowth?.product_name || "-"} · ↓ {lstmAnalytics.weakestGrowth?.product_name || "-"}
              </div>
            </div>
          </div>
        )}

        {lstmResults && (
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Predicted units (next)</th>
                  <th className="px-4 py-3 text-right">Recent units (last)</th>
                  <th className="px-4 py-3 text-right">Δ%</th>
                  <th className="px-4 py-3 text-right">MAE</th>
                  <th className="px-4 py-3 text-right">RMSE</th>
                  <th className="px-4 py-3 text-right">MAPE</th>
                  <th className="px-4 py-3 text-right">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {lstmResults.map((r) => (
                  <tr key={r.product_id} className="border-t">
                    <td className="px-4 py-3 text-gray-900 font-medium">{r.product_name}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{Math.round(r.predicted_total_units).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{Math.round(r.recent_total_units).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={r.delta_pct >= 0 ? "text-green-700" : "text-red-700"}>
                        {(r.delta_pct * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.mae_backtest.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.rmse_backtest.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.mape_backtest.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-right text-gray-700">{r.confidence_score.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
