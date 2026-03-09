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
} from "@/app/lib/salesRandomForest";
import {
  FORECASTING_DAY_OPTIONS,
  getNextScheduledDate,
  type ForecastingDay,
  type ForecastingRunMode,
  type ForecastingSettingsResponse,
  type LstmDemandResult,
  type ProductDemandSeriesResponse,
  type RandomForestSeriesForecast,
  type SalesSeriesResponse,
} from "@/app/lib/forecastingShared";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const FIXED_TRAINING_DAYS = 1095;

export default function SalesForecastingPage() {
  const trainingDays = FIXED_TRAINING_DAYS;
  const [lookback, setLookback] = useState(14);
  const [horizon, setHorizon] = useState(30);
  const [backtestDays, setBacktestDays] = useState(28);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<SalesSeriesResponse | null>(null);
  const [revForecast, setRevForecast] = useState<RandomForestSeriesForecast | null>(null);
  const [qtyForecast, setQtyForecast] = useState<RandomForestSeriesForecast | null>(null);
  const [rfSource, setRfSource] = useState<string | null>(null);

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
  const [lstmAutoTrainEnabled, setLstmAutoTrainEnabled] = useState(false);
  const [lstmAutoTrainDay, setLstmAutoTrainDay] = useState<ForecastingDay>("monday");
  const [lstmLastRunAt, setLstmLastRunAt] = useState<string | null>(null);
  const [lstmSource, setLstmSource] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const loadForecastingState = useCallback(async () => {
    const res = await fetch("/api/forecasting/settings", { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as ForecastingSettingsResponse & { error?: string };
    if (!res.ok) {
      throw new Error(json?.error || "Failed to load forecasting settings");
    }

    setLstmAutoTrainEnabled(Boolean(json.settings.autoTrainEnabled));
    setLstmAutoTrainDay(json.settings.autoTrainDay);
    setLstmLastRunAt(json.settings.lastRunAt || null);

    if (json.cache?.randomForest) {
      setSeries(json.cache.randomForest.series);
      setRevForecast(json.cache.randomForest.revenue);
      setQtyForecast(json.cache.randomForest.units);
      setRfSource(json.cache.randomForest.source);
    }

    if (json.cache?.lstm) {
      setLstmResults(json.cache.lstm.results);
      setLstmSource(json.cache.lstm.source);
    }

    return json;
  }, []);

  const run = useCallback(async (mode: ForecastingRunMode = "manual") => {
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
          persist: true,
          mode,
        }),
      });
      const forecastJson = await forecastRes.json().catch(() => ({}));
      if (!forecastRes.ok) throw new Error(forecastJson?.error || "Failed to run Random Forest forecasting");

      setRevForecast(forecastJson.revenue);
      setQtyForecast(forecastJson.units);
      setRfSource(forecastJson.source || null);
      setLstmLastRunAt(forecastJson.trainedAt || new Date().toISOString());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [backtestDays, horizon, lookback]);

  const saveSchedule = useCallback(async () => {
    try {
      setScheduleSaving(true);
      setScheduleMessage(null);

      const res = await fetch("/api/forecasting/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            autoTrainEnabled: lstmAutoTrainEnabled,
            autoTrainDay: lstmAutoTrainDay,
          },
        }),
      });
      const json = (await res.json().catch(() => ({}))) as ForecastingSettingsResponse & { error?: string };
      if (!res.ok) throw new Error(json?.error || "Failed to save forecasting schedule");

      setLstmAutoTrainEnabled(Boolean(json.settings.autoTrainEnabled));
      setLstmAutoTrainDay(json.settings.autoTrainDay);
      setLstmLastRunAt(json.settings.lastRunAt || null);
      setScheduleMessage("Automatic training schedule saved.");
    } catch (e: unknown) {
      setScheduleMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setScheduleSaving(false);
    }
  }, [lstmAutoTrainDay, lstmAutoTrainEnabled]);

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
    return {
      revenue: {
        rmse: revForecast.rmseBacktest,
        mape: revForecast.mapeBacktest,
        trendPct: revForecast.trendPct,
        recentSum: revForecast.recentSum,
        futureSum: revForecast.futureSum,
        volatilityPct: revForecast.volatilityPct,
        confidenceScore: revForecast.confidenceScore,
      },
      units: {
        rmse: qtyForecast.rmseBacktest,
        mape: qtyForecast.mapeBacktest,
        trendPct: qtyForecast.trendPct,
        recentSum: qtyForecast.recentSum,
        futureSum: qtyForecast.futureSum,
        volatilityPct: qtyForecast.volatilityPct,
        confidenceScore: qtyForecast.confidenceScore,
      },
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

  const runLstm = useCallback(async (mode: ForecastingRunMode = "manual") => {
    try {
      setLstmLoading(true);
      setLstmError(null);
      setLstmResults(null);

      const branchParam = lstmBranch.trim() ? `&branch=${encodeURIComponent(lstmBranch.trim())}` : "";
      const res = await fetch(
        `/api/analytics/product-demand-series?days=${FIXED_TRAINING_DAYS}&limit=${lstmLimit}${branchParam}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load product demand series");
      const data = json as ProductDemandSeriesResponse;

      const forecastRes = await fetch("/api/forecasting/lstm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: data.products,
          trainingDays: FIXED_TRAINING_DAYS,
          limit: lstmLimit,
          branch: lstmBranch.trim(),
          lookback: lstmLookback,
          horizon: lstmHorizon,
          epochs: lstmEpochs,
          persist: true,
          mode,
        }),
      });
      const forecastJson = await forecastRes.json().catch(() => ({}));
      if (!forecastRes.ok) throw new Error(forecastJson?.error || "Failed to run LSTM forecasting");

      setLstmResults(forecastJson.results || []);
      setLstmSource(forecastJson.source || null);
      setLstmLastRunAt(forecastJson.trainedAt || new Date().toISOString());
    } catch (e: unknown) {
      setLstmError(e instanceof Error ? e.message : String(e));
    } finally {
      setLstmLoading(false);
    }
  }, [lstmBranch, lstmEpochs, lstmHorizon, lstmLimit, lstmLookback]);

  useEffect(() => {
    if (autoRunDone) return;
    setAutoRunDone(true);
    void (async () => {
      try {
        const state = await loadForecastingState();
        if (!state.cache?.randomForest) {
          await run("manual");
        }
      } catch (stateError) {
        console.error("Failed to load forecasting state", stateError);
        await run("manual");
      }
    })();
  }, [autoRunDone, loadForecastingState, run]);

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

  const nextScheduledRunAt = useMemo(() => {
    if (!lstmAutoTrainEnabled) return null;
    return getNextScheduledDate(lstmAutoTrainDay);
  }, [lstmAutoTrainDay, lstmAutoTrainEnabled]);

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-black">Sales Forecasting</h1>
            <p className="mt-2 text-black text-sm">
              Random Forest forecasting trained on daily sales (from <span className="font-mono">/api/analytics/sales-series</span>).
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
              onClick={() => void run("manual")}
              disabled={loading}
            >
              {loading ? "Training…" : "Run Forecast"}
            </button>
          </div>
        </div>

        {error && <div className="mt-4 text-sm text-red-700">{error}</div>}

        {series && revForecast && qtyForecast && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
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
            <div className="p-3 rounded border bg-gray-50 text-black">
              <div className="font-semibold">Forecast Engine</div>
              <div className="mt-1 uppercase tracking-wide text-xs">{rfSource || "Unknown"}</div>
            </div>
          </div>
        )}

        {rfAnalytics && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 text-sm">
            <div className="p-3 rounded border bg-indigo-50 text-black">
              <div className="font-semibold">Revenue RMSE / MAPE</div>
              <div className="mt-1">₱{Math.round(rfAnalytics.revenue.rmse).toLocaleString()} / {rfAnalytics.revenue.mape.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-blue-50 text-black">
              <div className="font-semibold">Units RMSE / MAPE</div>
              <div className="mt-1">{rfAnalytics.units.rmse.toFixed(2)} / {rfAnalytics.units.mape.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-purple-50 text-black">
              <div className="font-semibold">Revenue Confidence</div>
              <div className="mt-1">{rfAnalytics.revenue.confidenceScore.toFixed(1)} / 100</div>
            </div>
            <div className="p-3 rounded border bg-sky-50 text-black">
              <div className="font-semibold">Units Confidence</div>
              <div className="mt-1">{rfAnalytics.units.confidenceScore.toFixed(1)} / 100</div>
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
            {lstmSource && <p className="text-xs text-gray-500 mt-1 uppercase tracking-wide">Engine: {lstmSource}</p>}
          </div>
          <button
            className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            onClick={() => void runLstm("manual")}
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
                checked={lstmAutoTrainEnabled}
                onChange={(e) => setLstmAutoTrainEnabled(e.target.checked)}
              />
              Enable automatic weekly training
            </label>
            <div>
              <label className="block text-xs text-gray-700 mb-1">Run on</label>
              <select
                className="w-full px-3 py-2 border rounded text-black bg-white"
                value={lstmAutoTrainDay}
                onChange={(e) => setLstmAutoTrainDay(e.target.value as ForecastingDay)}
                disabled={!lstmAutoTrainEnabled}
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
                Last run: {lstmLastRunAt ? new Date(lstmLastRunAt).toLocaleString() : "Not yet"}
              </div>
              <div>
                Next scheduled run: {nextScheduledRunAt ? nextScheduledRunAt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Disabled"}
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="w-full px-3 py-2 rounded border border-indigo-300 bg-indigo-600 text-white text-xs hover:bg-indigo-700 disabled:opacity-50"
                onClick={() => void saveSchedule()}
                disabled={scheduleSaving}
              >
                {scheduleSaving ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-600">
            A daily production cron checks this setting and runs both Random Forest and LSTM training on the selected day.
          </div>
          {scheduleMessage && <div className="mt-2 text-xs text-gray-700">{scheduleMessage}</div>}
        </div>

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
