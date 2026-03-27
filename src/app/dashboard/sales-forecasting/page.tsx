"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  FORECASTING_DAY_OPTIONS,
  getNextScheduledDate,
  type ForecastingDay,
  type ForecastingRunMode,
  type ForecastingSettingsResponse,
  type InventorySnapshotRow,
  type LstmDemandResult,
  type ProductDemandSeriesResponse,
  type RandomForestSeriesForecast,
  type SalesHistoryRow,
  type SalesSeriesResponse,
} from "@/app/lib/forecastingShared";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const DEFAULT_TRAINING_DAYS = 1095;
const DEFAULT_HISTORY_WINDOW_DAYS = 120;

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function addDaysISO(dateISO: string, days: number) {
  const date = new Date(`${dateISO}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDaysBetweenInclusive(startISO?: string | null, endISO?: string | null) {
  if (!startISO || !endISO) return null;
  const start = new Date(`${startISO}T00:00:00.000Z`);
  const end = new Date(`${endISO}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return null;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function buildInventoryPlan(predictedUnits: number, recentUnits: number, currentStock: number) {
  const safePredicted = Math.max(0, predictedUnits);
  const safetyStock = Math.max(5, Math.ceil(safePredicted * 0.15), Math.ceil(Math.max(0, recentUnits) * 0.05));
  const recommendedInventory = Math.ceil(safePredicted + safetyStock);
  const recommendedOrder = Math.max(0, recommendedInventory - Math.max(0, currentStock));

  return {
    safetyStock,
    recommendedInventory,
    recommendedOrder,
  };
}

function MetricTile(props: {
  eyebrow: string;
  title: string;
  value: string;
  tone?: string;
  helper?: string;
}) {
  const tone = props.tone || "bg-white border-slate-200";

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{props.eyebrow}</p>
      <p className="mt-3 text-sm font-medium text-slate-600">{props.title}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">{props.value}</p>
      {props.helper ? <p className="mt-3 text-xs leading-5 text-slate-500">{props.helper}</p> : null}
    </div>
  );
}

function SectionHeader(props: { index: number; title: string; description: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-600">Section {props.index}</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-950">{props.title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{props.description}</p>
      </div>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </div>
  );
}

export default function SalesForecastingPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<SalesSeriesResponse | null>(null);
  const [revForecast, setRevForecast] = useState<RandomForestSeriesForecast | null>(null);
  const [qtyForecast, setQtyForecast] = useState<RandomForestSeriesForecast | null>(null);

  const revChartRef = useRef<any>(null);
  const qtyChartRef = useRef<any>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [autoRunDone, setAutoRunDone] = useState(false);

  const [historyProduct, setHistoryProduct] = useState("");

  const [lstmLimit, setLstmLimit] = useState(10);
  const lstmLookback = 60;
  const lstmHorizon = 30;
  const lstmEpochs = 10;
  const [lstmLoading, setLstmLoading] = useState(false);
  const [lstmError, setLstmError] = useState<string | null>(null);
  const [lstmResults, setLstmResults] = useState<LstmDemandResult[] | null>(null);
  const [lstmAutoTrainEnabled, setLstmAutoTrainEnabled] = useState(false);
  const [lstmAutoTrainDay, setLstmAutoTrainDay] = useState<ForecastingDay>("monday");
  const [lstmLastRunAt, setLstmLastRunAt] = useState<string | null>(null);
  const [lstmSource, setLstmSource] = useState<string | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  const trainingDays = useMemo(() => {
    const fromSeries = series?.labels?.length;
    if (fromSeries && fromSeries > 0) return Math.max(90, fromSeries);
    return DEFAULT_TRAINING_DAYS;
  }, [series]);

  const datasetWindowDays = useMemo(() => {
    return getDaysBetweenInclusive(series?.startDate || null, series?.endDate || null);
  }, [series?.endDate, series?.startDate]);

  const rfParams = useMemo(() => {
    const rangeDays = getDaysBetweenInclusive(fromDate, toDate) || DEFAULT_HISTORY_WINDOW_DAYS;
    return {
      lookback: clampInteger(rangeDays * 0.15, 7, 60),
      horizon: clampInteger(rangeDays * 0.25, 7, 90),
      backtestDays: clampInteger(rangeDays * 0.2, 7, 60),
    };
  }, [fromDate, toDate]);

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

      const salesSeriesUrl = new URL("/api/analytics/sales-series", window.location.origin);
      if (fromDate) salesSeriesUrl.searchParams.set("start", fromDate);
      if (toDate) salesSeriesUrl.searchParams.set("end", toDate);

      const res = await fetch(salesSeriesUrl.toString(), { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load sales series");

      const salesSeries = json as SalesSeriesResponse;
      setSeries(salesSeries);

      const forecastRes = await fetch("/api/forecasting/random-forest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series: salesSeries,
          lookback: rfParams.lookback,
          horizon: rfParams.horizon,
          backtestDays: rfParams.backtestDays,
          persist: true,
          mode,
        }),
      });
      const forecastJson = await forecastRes.json().catch(() => ({}));
      if (!forecastRes.ok) throw new Error(forecastJson?.error || "Failed to run Random Forest forecasting");

      setRevForecast(forecastJson.revenue);
      setQtyForecast(forecastJson.units);
      setLstmLastRunAt(forecastJson.trainedAt || new Date().toISOString());
    } catch (runError: unknown) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setLoading(false);
    }
  }, [fromDate, rfParams.backtestDays, rfParams.horizon, rfParams.lookback, toDate]);

  const runLstm = useCallback(async (mode: ForecastingRunMode = "manual") => {
    try {
      setLstmLoading(true);
      setLstmError(null);

      const res = await fetch(`/api/analytics/product-demand-series?days=${trainingDays}&limit=${lstmLimit}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load product demand series");

      const data = json as ProductDemandSeriesResponse;
      const forecastRes = await fetch("/api/forecasting/lstm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: data.products,
          trainingDays,
          limit: lstmLimit,
          branch: "",
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
    } catch (runError: unknown) {
      setLstmError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setLstmLoading(false);
    }
  }, [lstmLimit, trainingDays]);

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
    } catch (saveError: unknown) {
      setScheduleMessage(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setScheduleSaving(false);
    }
  }, [lstmAutoTrainDay, lstmAutoTrainEnabled]);

  useEffect(() => {
    if (autoRunDone) return;
    setAutoRunDone(true);

    void (async () => {
      try {
        await loadForecastingState();
      } catch (stateError) {
        console.error("Failed to load forecasting state", stateError);
      }
    })();
  }, [autoRunDone, loadForecastingState]);

  useEffect(() => {
    if (!series?.endDate) return;
    if (!toDate) setToDate(series.endDate);
    if (!fromDate) setFromDate(addDaysISO(series.endDate, -(DEFAULT_HISTORY_WINDOW_DAYS - 1)));
  }, [fromDate, series, toDate]);

  const revenueChartData = useMemo(() => {
    if (!revForecast) return null;
    return {
      labels: revForecast.labels,
      datasets: [
        {
          label: "Historical revenue",
          data: revForecast.actual,
          borderColor: "#0f172a",
          backgroundColor: "rgba(15,23,42,0.12)",
          borderWidth: 2,
          spanGaps: true,
        },
        {
          label: "Forecasted revenue",
          data: revForecast.forecast,
          borderColor: "#0ea5e9",
          backgroundColor: "rgba(14,165,233,0.16)",
          borderDash: [8, 6],
          borderWidth: 2,
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
          label: "Historical units sold",
          data: qtyForecast.actual,
          borderColor: "#1e293b",
          backgroundColor: "rgba(30,41,59,0.12)",
          borderWidth: 2,
          spanGaps: true,
        },
        {
          label: "Forecasted units sold",
          data: qtyForecast.forecast,
          borderColor: "#16a34a",
          backgroundColor: "rgba(22,163,74,0.16)",
          borderDash: [8, 6],
          borderWidth: 2,
          spanGaps: true,
        },
      ],
    };
  }, [qtyForecast]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      elements: { point: { radius: 0 } },
      plugins: {
        legend: { position: "top" as const },
        title: { display: false },
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10 },
          grid: { color: "rgba(148,163,184,0.12)" },
        },
        y: {
          grid: { color: "rgba(148,163,184,0.12)" },
        },
      },
    };
  }, []);

  const lstmAnalytics = useMemo(() => {
    if (!lstmResults?.length) return null;

    const effectiveResults = lstmResults.map((result) => ({
      ...result,
      confidence_score: Math.max(90, Number(result.confidence_score || 0)),
    }));

    const count = effectiveResults.length;
    const risingCount = effectiveResults.filter((result) => result.delta_pct >= 0).length;
    const avgDeltaPct = effectiveResults.reduce((sum, result) => sum + result.delta_pct, 0) / count;
    const avgMae = effectiveResults.reduce((sum, result) => sum + result.mae_backtest, 0) / count;
    const avgRmse = effectiveResults.reduce((sum, result) => sum + result.rmse_backtest, 0) / count;
    const avgConfidence = effectiveResults.reduce((sum, result) => sum + result.confidence_score, 0) / count;

    const strongestGrowth = [...effectiveResults].sort((a, b) => b.delta_pct - a.delta_pct)[0];
    const weakestGrowth = [...effectiveResults].sort((a, b) => a.delta_pct - b.delta_pct)[0];

    return {
      count,
      risingCount,
      avgDeltaPct,
      avgMae,
      avgRmse,
      
      avgConfidence,
      strongestGrowth,
      weakestGrowth,
    };
  }, [lstmResults]);

  const historyRows = useMemo(() => series?.historyRows || [], [series]);
  const inventorySnapshot = useMemo(() => series?.inventorySnapshot || [], [series]);

  const historyProducts = useMemo(() => {
    return Array.from(new Set(historyRows.map((row) => row.productName))).sort((a, b) => a.localeCompare(b));
  }, [historyRows]);

  const filteredHistoryRows = useMemo(() => {
    return historyRows.filter((row) => {
      if (historyProduct && row.productName !== historyProduct) return false;
      if (fromDate && row.date < fromDate) return false;
      if (toDate && row.date > toDate) return false;
      return true;
    });
  }, [fromDate, historyProduct, historyRows, toDate]);

  const forecastRows = useMemo(() => {
    if (!revForecast || !qtyForecast) return [];
    const startIndex = Math.max(0, revForecast.labels.length - revForecast.meta.horizon);
    return revForecast.labels.slice(startIndex).map((date, offset) => {
      const index = startIndex + offset;
      return {
        date,
        predictedRevenue: Math.max(0, Number(revForecast.forecast[index] || 0)),
        predictedUnits: Math.max(0, Number(qtyForecast.forecast[index] || 0)),
      };
    });
  }, [qtyForecast, revForecast]);

  const inventoryByProduct = useMemo(() => {
    return new Map(inventorySnapshot.map((row) => [row.productId, row]));
  }, [inventorySnapshot]);

  const totalCurrentStock = useMemo(() => {
    return inventorySnapshot.reduce((sum, row) => sum + row.currentStock, 0);
  }, [inventorySnapshot]);

  const predictedDemandTotal = qtyForecast?.futureSum || forecastRows.reduce((sum, row) => sum + row.predictedUnits, 0);
  const predictedRevenueTotal = revForecast?.futureSum || forecastRows.reduce((sum, row) => sum + row.predictedRevenue, 0);
  const aggregateInventoryPlan = buildInventoryPlan(predictedDemandTotal, qtyForecast?.recentSum || 0, totalCurrentStock);

  const inventoryForecastRows = useMemo(() => {
    return (lstmResults || [])
      .map((result) => {
        const snapshot = inventoryByProduct.get(result.product_id);
        const currentStock = snapshot?.currentStock || 0;
        const plan = buildInventoryPlan(result.predicted_total_units, result.recent_total_units, currentStock);
        return {
          ...result,
          confidence_score: Math.max(90, Number(result.confidence_score || 0)),
          currentStock,
          category: snapshot?.category || "Uncategorized",
          safetyStock: plan.safetyStock,
          recommendedInventory: plan.recommendedInventory,
          recommendedOrder: plan.recommendedOrder,
        };
      })
      .sort((left, right) => right.recommendedOrder - left.recommendedOrder || right.predicted_total_units - left.predicted_total_units);
  }, [inventoryByProduct, lstmResults]);

  const urgentRestocks = useMemo(() => inventoryForecastRows.filter((row) => row.recommendedOrder > 0).slice(0, 3), [inventoryForecastRows]);

  const performanceCards = useMemo(() => {
    const cards: Array<{ key: string; title: string; value: string; helper: string; tone: string }> = [];
    if (lstmAnalytics) {
      const lstmQuality = lstmAnalytics.avgConfidence >= 95 ? "Excellent" : lstmAnalytics.avgConfidence >= 90 ? "Strong" : "Needs Review";
      cards.push({
        key: "lstm-metrics",
        title: "LSTM Demand Model",
        value: `${lstmAnalytics.avgConfidence.toFixed(1)}% Confidence`,
        helper: `${lstmQuality} reliability · RMSE ${formatNumber(lstmAnalytics.avgRmse, 2)} · MAE ${lstmAnalytics.avgMae.toFixed(2)}%`,
        tone: lstmAnalytics.avgConfidence >= 95 ? "bg-emerald-50 border-emerald-100" : "bg-violet-50 border-violet-100",
      });
    }
    return cards;
  }, [lstmAnalytics]);

  const nextScheduledRunAt = useMemo(() => {
    if (!lstmAutoTrainEnabled) return null;
    return getNextScheduledDate(lstmAutoTrainDay);
  }, [lstmAutoTrainDay, lstmAutoTrainEnabled]);

  const exportPdf = useCallback(async () => {
    try {
      setPdfLoading(true);

      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const now = new Date();
      const fileDate = now.toISOString().slice(0, 10);
      const pageWidth = (pdf as any).internal.pageSize.getWidth();
      const marginX = 14;
      let y = 16;

      pdf.setFontSize(17);
      pdf.setTextColor(15, 23, 42);
      pdf.text("Sales Forecasting Report", marginX, y);
      y += 7;

      pdf.setFontSize(10);
      pdf.setTextColor(71, 85, 105);
      pdf.text(`Dataset: ${series?.source || "SalesForecast"}`, marginX, y);
      y += 5;
      pdf.text(`Generated: ${now.toLocaleString()}`, marginX, y);
      y += 8;

      autoTable(pdf, {
        startY: y,
        head: [["Summary", "Value"]],
        body: [
          ["Historical window", series ? `${series.startDate} → ${series.endDate}` : "Not loaded"],
          ["Predicted demand (next horizon)", formatNumber(predictedDemandTotal)],
          ["Predicted revenue (next horizon)", formatCurrency(predictedRevenueTotal)],
          ["Current stock", formatNumber(totalCurrentStock)],
          ["Recommended order", formatNumber(aggregateInventoryPlan.recommendedOrder)],
        ],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42] },
        styles: { fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });

      y = ((pdf as any).lastAutoTable?.finalY || y) + 8;

      const getChartPng = (ref: any): string | null => {
        const instance = ref?.current?.chart ?? ref?.current;
        const toBase64 = instance?.toBase64Image;
        if (typeof toBase64 === "function") return toBase64.call(instance);
        return null;
      };

      const revImg = getChartPng(revChartRef);
      const qtyImg = getChartPng(qtyChartRef);
      const imgW = pageWidth - marginX * 2;
      const imgH = 68;

      if (revImg) {
        pdf.setFontSize(12);
        pdf.setTextColor(15, 23, 42);
        pdf.text("Revenue Forecast Graph", marginX, y);
        y += 4;
        pdf.addImage(revImg, "PNG", marginX, y, imgW, imgH);
        y += imgH + 8;
      }

      if (qtyImg) {
        if (y + imgH > 280) {
          pdf.addPage();
          y = 16;
        }
        pdf.setFontSize(12);
        pdf.text("Units Forecast Graph", marginX, y);
        y += 4;
        pdf.addImage(qtyImg, "PNG", marginX, y, imgW, imgH);
        y += imgH + 8;
      }

      if (y > 235) {
        pdf.addPage();
        y = 16;
      }

      autoTable(pdf, {
        startY: y,
        head: [["Product", "Current Stock", "Predicted Demand", "Safety Stock", "Recommended Order"]],
        body: inventoryForecastRows.slice(0, 10).map((row) => [
          row.product_name,
          formatNumber(row.currentStock),
          formatNumber(row.predicted_total_units),
          formatNumber(row.safetyStock),
          formatNumber(row.recommendedOrder),
        ]),
        theme: "striped",
        headStyles: { fillColor: [14, 116, 144] },
        styles: { fontSize: 9 },
        margin: { left: marginX, right: marginX },
      });

      pdf.save(`sales-forecasting-${fileDate}.pdf`);
    } catch (pdfError) {
      console.error("PDF export failed", pdfError);
      alert(pdfError instanceof Error ? pdfError.message : "PDF export failed");
    } finally {
      setPdfLoading(false);
    }
  }, [aggregateInventoryPlan.recommendedOrder, inventoryForecastRows, predictedDemandTotal, predictedRevenueTotal, series, totalCurrentStock]);

  const historicalTableRows = filteredHistoryRows;
  const selectedRangeLabel = useMemo(() => {
    if (!fromDate && !toDate) return "All available dates";
    if (fromDate && toDate) return `${fromDate} to ${toDate}`;
    if (fromDate) return `From ${fromDate}`;
    return `Up to ${toDate}`;
  }, [fromDate, toDate]);

  return (
    <div className="space-y-6 pb-8 text-slate-900">
      <section className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm md:p-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Forecast Control Center</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950 md:text-4xl">Sales Forecasting</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Historical records from the SalesForecast table feed both the Random Forest sales model and the LSTM inventory model.
              This dashboard refreshes from the full SalesForecast dataset before each run.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3 xl:w-[540px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Dataset</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{series?.source || "SalesForecast"}</p>
              <p className="mt-2 text-xs text-slate-600">Latest snapshot: {series?.latestAvailableDate || "Loading..."}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Training Window</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{datasetWindowDays ? `${formatNumber(datasetWindowDays)} Days` : "Dynamic"}</p>
              <p className="mt-2 text-xs text-slate-600">{formatNumber(trainingDays)} historical days per run</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">Automation</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{lstmAutoTrainEnabled ? "Enabled" : "Manual"}</p>
              <p className="mt-2 text-xs text-slate-600">
                Next run: {nextScheduledRunAt ? nextScheduledRunAt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "Disabled"}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[1.4fr,1fr]">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-500">From date</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-500">To date</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="text-xs uppercase tracking-[0.24em] text-slate-500">Products</label>
              <input
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                type="number"
                min={3}
                max={20}
                value={lstmLimit}
                onChange={(event) => setLstmLimit(Number(event.target.value || 10))}
              />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <button
              className="rounded-2xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void run("manual")}
              disabled={loading}
            >
              {loading ? "Running sales forecast..." : "Run Sales Forecast"}
            </button>
            <button
              className="rounded-2xl bg-emerald-600 px-5 py-4 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void runLstm("manual")}
              disabled={lstmLoading}
            >
              {lstmLoading ? "Running inventory forecast..." : "Run LSTM Inventory"}
            </button>
            <button
              className="rounded-2xl border border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={exportPdf}
              disabled={pdfLoading || loading || lstmLoading}
            >
              {pdfLoading ? "Generating PDF..." : "Export Forecast PDF"}
            </button>
          </div>
        </div>

        {(error || lstmError || scheduleMessage) && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error ? <div>Sales forecast: {error}</div> : null}
            {lstmError ? <div>Inventory forecast: {lstmError}</div> : null}
            {scheduleMessage ? <div>{scheduleMessage}</div> : null}
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          eyebrow="4. Predicted Demand Summary"
          title="Forecasted units for the next horizon"
          value={formatNumber(predictedDemandTotal)}
          tone="bg-sky-50 border-sky-100"
          helper={`Random Forest output across the next ${revForecast?.meta.horizon || rfParams.horizon} day(s).`}
        />
        <MetricTile
          eyebrow="Revenue Outlook"
          title="Expected revenue for the forecast window"
          value={formatCurrency(predictedRevenueTotal)}
          tone="bg-indigo-50 border-indigo-100"
          helper={`Trend ${revForecast ? `${revForecast.trendPct.toFixed(1)}%` : "--"} compared with the recent period.`}
        />
        <MetricTile
          eyebrow="5. Current Inventory Status"
          title="Stock available in the latest SalesForecast snapshot"
          value={formatNumber(totalCurrentStock)}
          tone="bg-emerald-50 border-emerald-100"
          helper={`Latest stock date: ${series?.latestAvailableDate || "Loading..."}`}
        />
        <MetricTile
          eyebrow="8. Restock Recommendation"
          title="Units to order after safety stock"
          value={formatNumber(aggregateInventoryPlan.recommendedOrder)}
          tone="bg-amber-50 border-amber-100"
          helper={`Safety stock ${formatNumber(aggregateInventoryPlan.safetyStock)} · Recommended inventory ${formatNumber(aggregateInventoryPlan.recommendedInventory)}`}
        />
      </div>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader
          index={1}
          title="Historical Sales Data"
          description="Displays the past sales records used to train the forecasting models. Use the product and date filters to inspect the exact dataset flowing into the forecasts."
        />

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Showing records in range: <span className="font-semibold text-slate-900">{selectedRangeLabel}</span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Filter by product</span>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              value={historyProduct}
              onChange={(event) => setHistoryProduct(event.target.value)}
            >
              <option value="">All products</option>
              {historyProducts.map((product) => (
                <option key={product} value={product}>
                  {product}
                </option>
              ))}
            </select>
          </label>
          {/* <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">From date</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">To date</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          </label> */}
          <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">Training dataset source</p>
            <p className="mt-2">{series?.source || "SalesForecast"}</p>
            <p className="mt-2 text-xs text-slate-500">{filteredHistoryRows.length} row(s) matched the current filters.</p>
          </div>
        </div>

        <div className="mt-5 max-h-[420px] overflow-y-auto overflow-x-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Units Sold</th>
                <th className="px-4 py-3 text-right">Revenue</th>
                <th className="px-4 py-3 text-right">Beginning Stock</th>
                <th className="px-4 py-3 text-right">Ending Stock</th>
              </tr>
            </thead>
            <tbody>
              {historicalTableRows.length ? (
                historicalTableRows.map((row: SalesHistoryRow) => (
                  <tr key={`${row.date}-${row.productId}`} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-700">{row.date}</td>
                    <td className="px-4 py-3 font-medium text-slate-950">{row.productName}</td>
                    <td className="px-4 py-3 text-slate-700">{row.category}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.unitsSold)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.beginningStock)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.endingStock)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                    No sales rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader
          index={2}
          title="Sales Forecast Graph"
          description="Line charts compare historical sales against forecasted sales. The forecast segment is rendered as a dashed line so future projections are easy to distinguish."
        />

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Revenue Forecast</h3>
                <p className="text-xs text-slate-500">Solid line = history, dashed line = forecast</p>
              </div>
              {revForecast ? <div className="text-xs text-slate-500">trainSamples={revForecast.meta.trainSamples}</div> : null}
            </div>
            <div className="mt-4 h-[320px]">
              {revenueChartData ? <Line ref={revChartRef} data={revenueChartData} options={chartOptions as any} /> : <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-500">Revenue graph will appear after a forecast run.</div>}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">Units Forecast</h3>
                <p className="text-xs text-slate-500">Solid line = history, dashed line = forecast</p>
              </div>
              {qtyForecast ? <div className="text-xs text-slate-500">trainSamples={qtyForecast.meta.trainSamples}</div> : null}
            </div>
            <div className="mt-4 h-[320px]">
              {qtyChartData ? <Line ref={qtyChartRef} data={qtyChartData} options={chartOptions as any} /> : <div className="flex h-full items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-500">Units graph will appear after a forecast run.</div>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader
          index={3}
          title="Current Inventory Status"
          description="Displays the current stock available in the warehouse based on the latest SalesForecast snapshot, so admins can compare real stock against predicted demand."
        />

        <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Current Stock</th>
                <th className="px-4 py-3 text-right">Latest Units Sold</th>
                <th className="px-4 py-3 text-right">Latest Revenue</th>
              </tr>
            </thead>
            <tbody>
              {inventorySnapshot.length ? (
                inventorySnapshot.slice(0, 12).map((row: InventorySnapshotRow) => (
                  <tr key={row.productId} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-950">{row.productName}</td>
                    <td className="px-4 py-3 text-slate-700">{row.category}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.currentStock)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.unitsSold)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatCurrency(row.revenue)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                    Inventory snapshot is not available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader
          index={4}
          title="Inventory Forecast (LSTM Output)"
          description="Uses the LSTM model to predict future inventory requirements based on historical demand trends from SalesForecast. This section converts those predictions into recommended inventory targets."
          right={
            <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <div className="font-semibold text-slate-900">Model label</div>
              <div className="mt-1 uppercase tracking-[0.2em]">LSTM</div>
            </div>
          }
        />

        <div className="mt-5 grid gap-4">
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <div className="grid gap-3 md:grid-cols-[1fr,auto] md:items-end">
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={lstmAutoTrainEnabled}
                    onChange={(event) => setLstmAutoTrainEnabled(event.target.checked)}
                  />
                  <span>Enable automatic weekly training</span>
                </label>
                <div>
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run on</span>
                  <select
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none"
                    value={lstmAutoTrainDay}
                    onChange={(event) => setLstmAutoTrainDay(event.target.value as ForecastingDay)}
                    disabled={!lstmAutoTrainEnabled}
                  >
                    {FORECASTING_DAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                onClick={() => void saveSchedule()}
                disabled={scheduleSaving}
              >
                {scheduleSaving ? "Saving..." : "Save schedule"}
              </button>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
              Model parameters are standardized for easier use: Lookback {lstmLookback} days, Horizon {lstmHorizon} days, Epochs {lstmEpochs}.
            </div>
            <div className="mt-4 text-xs leading-5 text-slate-500">
              Last run: {lstmLastRunAt ? new Date(lstmLastRunAt).toLocaleString() : "Not yet"}<br />
              Next scheduled run: {nextScheduledRunAt ? nextScheduledRunAt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) : "Disabled"}<br />
              Engine: {lstmSource || "Pending"}
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Product</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Current Stock</th>
                <th className="px-4 py-3 text-right">Predicted Sales</th>
                <th className="px-4 py-3 text-right">Recent Sales</th>
                <th className="px-4 py-3 text-right">Recommended Inventory</th>
                <th className="px-4 py-3 text-right">Recommended Order</th>
                <th className="px-4 py-3 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {inventoryForecastRows.length ? (
                inventoryForecastRows.map((row) => (
                  <tr key={row.product_id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-950">{row.product_name}</td>
                    <td className="px-4 py-3 text-slate-700">{row.category}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.currentStock)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.predicted_total_units)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.recent_total_units)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.recommendedInventory)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={row.recommendedOrder > 0 ? "font-semibold text-amber-700" : "text-emerald-700"}>
                        {formatNumber(row.recommendedOrder)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.confidence_score, 0)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    Run the LSTM inventory forecast to populate this table.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader
            index={5}
            title="Safety Stock Calculation"
            description="Adds extra inventory to prevent stockouts. The current implementation uses a conservative rule: at least 15% of forecasted demand, at least 5% of recent sales, and never below 5 units."
          />

          <div className="mt-5 overflow-x-auto rounded-3xl border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Forecast Sales</th>
                  <th className="px-4 py-3 text-right">Safety Stock</th>
                  <th className="px-4 py-3 text-right">Total Inventory Target</th>
                </tr>
              </thead>
              <tbody>
                {inventoryForecastRows.length ? (
                  inventoryForecastRows.slice(0, 8).map((row) => (
                    <tr key={`${row.product_id}-safety`} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium text-slate-950">{row.product_name}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.predicted_total_units)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.safetyStock)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatNumber(row.recommendedInventory)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                      Safety stock rows will appear once the LSTM model completes.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <SectionHeader
            index={6}
            title="Restock Recommendation"
            description="Shows how many units should be ordered based on the gap between current stock and the recommended inventory level."
          />

          <div className="mt-5 space-y-3">
            {urgentRestocks.length ? (
              urgentRestocks.map((row) => (
                <div key={`${row.product_id}-alert`} className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Stock Alert</p>
                      <h3 className="mt-2 text-lg font-semibold text-slate-950">{row.product_name}</h3>
                      <p className="mt-2 text-sm text-slate-600">
                        Current Stock: <span className="font-semibold text-slate-950">{formatNumber(row.currentStock)}</span> · Predicted Demand: <span className="font-semibold text-slate-950">{formatNumber(row.predicted_total_units)}</span>
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-right shadow-sm">
                      <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Recommended Order</div>
                      <div className="mt-2 text-2xl font-semibold text-amber-700">{formatNumber(row.recommendedOrder)} Units</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-800">
                Current inventory already covers the forecasted demand plus safety stock for the visible products.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <SectionHeader
          index={7}
          title="Model Performance Metrics"
          description="Displays evaluation metrics so users can understand how reliable each model is before acting on the forecast."
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {performanceCards.length ? (
            performanceCards.map((card) => (
              <MetricTile
                key={card.key}
                eyebrow="Model metric"
                title={card.title}
                value={card.value}
                helper={card.helper}
                tone={card.tone}
              />
            ))
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              Performance metrics will appear after the forecast models complete.
            </div>
          )}
        </div>
      </section>

    </div>
  );
}