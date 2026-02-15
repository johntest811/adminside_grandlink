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

import * as tf from "@tensorflow/tfjs";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthSinCos(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  const m = d.getUTCMonth();
  const angle = (2 * Math.PI * m) / 12;
  return [Math.sin(angle), Math.cos(angle)];
}

function zNormalize(values: number[]) {
  const clean = values.filter((v) => Number.isFinite(v));
  const mean = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
  const variance =
    clean.length > 1
      ? clean.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (clean.length - 1)
      : 0;
  const std = Math.sqrt(variance) || 1;
  return {
    mean,
    std,
    norm: (v: number) => (v - mean) / std,
    denorm: (v: number) => v * std + mean,
  };
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

async function trainAndForecastDemandLSTM(params: {
  labels: string[];
  quantities: number[];
  lookback: number;
  horizon: number;
  epochs: number;
}) {
  const lookback = Math.max(14, Math.min(120, Math.floor(params.lookback)));
  const horizon = Math.max(7, Math.min(90, Math.floor(params.horizon)));
  const epochs = Math.max(4, Math.min(30, Math.floor(params.epochs)));

  const labels = params.labels;
  const values = params.quantities.map((v) => (Number.isFinite(v) ? Number(v) : 0));
  if (labels.length !== values.length) throw new Error("Series shape mismatch");
  if (values.length < lookback + 30) throw new Error("Not enough history for LSTM");

  const zn = zNormalize(values);
  const norm = values.map(zn.norm);

  const X: number[][][] = [];
  const y: number[] = [];

  for (let t = lookback; t < norm.length; t++) {
    const window: number[][] = [];
    for (let i = t - lookback; i < t; i++) {
      const [ms, mc] = monthSinCos(labels[i]);
      window.push([norm[i], ms, mc]);
    }
    X.push(window);
    y.push(norm[t]);
  }

  const desiredTestSize = Math.max(7, Math.floor(X.length * 0.15));
  const testSize = Math.max(1, Math.min(desiredTestSize, Math.max(1, X.length - 5)));
  const trainSize = X.length - testSize;
  if (trainSize < 5) throw new Error("Not enough training samples for LSTM");

  const XTrain = X.slice(0, trainSize);
  const yTrain = y.slice(0, trainSize);
  const XTest = X.slice(trainSize);
  const yTest = y.slice(trainSize);

  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 16,
      inputShape: [lookback, 3],
      returnSequences: false,
    })
  );
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });

  const XTrainTensor = tf.tensor3d(XTrain, [XTrain.length, lookback, 3]);
  const yTrainTensor = tf.tensor2d(yTrain, [yTrain.length, 1]);

  await model.fit(XTrainTensor, yTrainTensor, {
    epochs,
    batchSize: 32,
    shuffle: true,
    validationSplit: XTrain.length > 12 ? 0.1 : 0,
    verbose: 0,
  });

  XTrainTensor.dispose();
  yTrainTensor.dispose();

  let metrics = { mae: 0, rmse: 0, mape: 0, bias: 0, sampleSize: 0 };
  if (XTest.length) {
    const XTestTensor = tf.tensor3d(XTest, [XTest.length, lookback, 3]);
    const yPredTensor = model.predict(XTestTensor) as tf.Tensor;
    const yPredNorm = Array.from(await yPredTensor.data());
    XTestTensor.dispose();
    yPredTensor.dispose();

    const actualDenorm = yTest.map((value) => Math.max(0, zn.denorm(value)));
    const predDenorm = yPredNorm.map((value) => Math.max(0, zn.denorm(value)));
    metrics = computeRegressionMetrics(actualDenorm, predDenorm);
  }

  // Forecast horizon iteratively
  let windowValues = norm.slice(norm.length - lookback);
  let windowDates = labels.slice(labels.length - lookback);
  const lastDate = labels[labels.length - 1];
  const preds: number[] = [];
  for (let i = 1; i <= horizon; i++) {
    const seq = windowValues.map((q, idx) => {
      const [ms, mc] = monthSinCos(windowDates[idx]);
      return [q, ms, mc];
    });
    const t = tf.tensor3d([seq], [1, lookback, 3]);
    const pred = model.predict(t) as tf.Tensor;
    const nextNorm = (await pred.data())[0];
    t.dispose();
    pred.dispose();

    preds.push(Math.max(0, zn.denorm(nextNorm)));

    const nextDate = addDaysISO(lastDate, i);
    windowValues = windowValues.slice(1).concat(nextNorm);
    windowDates = windowDates.slice(1).concat(nextDate);
  }

  model.dispose();

  const baseline = values.slice(Math.max(0, values.length - horizon));
  const baselineMean = baseline.length
    ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length
    : 1;
  const errorRatio = metrics.mae / Math.max(1, baselineMean);
  const confidenceScore = Math.max(5, Math.min(99, 100 - metrics.mape * 0.8 - errorRatio * 60));

  return {
    horizon,
    predicted_total: preds.reduce((a, b) => a + b, 0),
    recent_total: values.slice(Math.max(0, values.length - horizon)).reduce((a, b) => a + b, 0),
    mae_backtest: metrics.mae,
    rmse_backtest: metrics.rmse,
    mape_backtest: metrics.mape,
    confidence_score: confidenceScore,
  };
}

export default function SalesForecastingPage() {
  const [trainingDays, setTrainingDays] = useState(180);
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
  const [lstmDays, setLstmDays] = useState(270);
  const [lstmLimit, setLstmLimit] = useState(10);
  const [lstmBranch, setLstmBranch] = useState<string>("");
  const [lstmLookback, setLstmLookback] = useState(60);
  const [lstmHorizon, setLstmHorizon] = useState(30);
  const [lstmEpochs, setLstmEpochs] = useState(10);
  const [lstmLoading, setLstmLoading] = useState(false);
  const [lstmError, setLstmError] = useState<string | null>(null);
  const [lstmResults, setLstmResults] = useState<LstmDemandResult[] | null>(null);

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
      start.setDate(end.getDate() - Math.max(30, Math.min(365, trainingDays)));
      const startISO = start.toISOString().slice(0, 10);
      const endISO = end.toISOString().slice(0, 10);

      const res = await fetch(`/api/analytics/sales-series?start=${startISO}&end=${endISO}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load sales series");
      const s = json as SalesSeriesResponse;
      setSeries(s);

      const revRf = new RFRegression({
        nEstimators: 160,
        maxFeatures: Math.max(2, Math.floor(Math.sqrt(lookback + 3))),
        replacement: true,
        seed: 42,
      });
      const qtyRf = new RFRegression({
        nEstimators: 160,
        maxFeatures: Math.max(2, Math.floor(Math.sqrt(lookback + 3))),
        replacement: true,
        seed: 42,
      });

      const rev = await trainAndForecastDailyRF({
        rf: revRf,
        series: { labels: s.labels, values: s.revenue },
        lookback,
        horizon,
        backtestDays,
      });
      const qty = await trainAndForecastDailyRF({
        rf: qtyRf,
        series: { labels: s.labels, values: s.quantities },
        lookback,
        horizon,
        backtestDays,
      });
      setRevForecast(rev);
      setQtyForecast(qty);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [backtestDays, horizon, lookback, trainingDays]);

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
        .filter((value) => Number.isFinite(value));
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

  const runLstm = useCallback(async () => {
    try {
      setLstmLoading(true);
      setLstmError(null);
      setLstmResults(null);
      setLstmProgress(null);

      const branchParam = lstmBranch.trim() ? `&branch=${encodeURIComponent(lstmBranch.trim())}` : "";
      const res = await fetch(
        `/api/analytics/product-demand-series?days=${lstmDays}&limit=${lstmLimit}${branchParam}`,
        { cache: "no-store" }
      );
      const json = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(json?.error || "Failed to load product demand series");
      const data = json as ProductDemandSeriesResponse;

      // Train per-product (sequential to avoid GPU/memory spikes)
      const results: LstmDemandResult[] = [];
      const products = (data.products || []).slice(0, Math.min(12, lstmLimit));
      setLstmProgress({ current: 0, total: products.length, label: "Preparing…" });
      for (const p of products) {
        setLstmProgress({
          current: results.length + 1,
          total: products.length,
          label: `Training ${p.product_name}`,
        });
        const r = await trainAndForecastDemandLSTM({
          labels: p.labels,
          quantities: p.quantities,
          lookback: lstmLookback,
          horizon: lstmHorizon,
          epochs: lstmEpochs,
        });
        const delta = r.recent_total > 0 ? (r.predicted_total - r.recent_total) / r.recent_total : 0;
        results.push({
          product_id: p.product_id,
          product_name: p.product_name,
          predicted_total_units: r.predicted_total,
          recent_total_units: r.recent_total,
          delta_pct: delta,
          mae_backtest: r.mae_backtest,
          rmse_backtest: r.rmse_backtest,
          mape_backtest: r.mape_backtest,
          confidence_score: r.confidence_score,
        });

        // Yield to UI + help prevent long-blocking tasks
        await tf.nextFrame();
      }

      results.sort((a, b) => b.predicted_total_units - a.predicted_total_units);
      setLstmResults(results);
    } catch (e: unknown) {
      setLstmError(e instanceof Error ? e.message : String(e));
    } finally {
      setLstmProgress(null);
      setLstmLoading(false);
    }
  }, [lstmBranch, lstmDays, lstmEpochs, lstmHorizon, lstmLimit, lstmLookback]);

  useEffect(() => {
    if (autoRunDone) return;
    setAutoRunDone(true);
    void run();
    void runLstm();
  }, [autoRunDone, run, runLstm]);

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
      const res = await fetch(`/api/analytics/sales-inventory-9months?months=9`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to build sales_inventory_9months");
      setSyncMessage(`Upserted ${json?.rowsUpserted || 0} rows into sales_inventory_9months`);
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
            {syncLoading ? "Syncing…" : "Sync sales_inventory_9months"}
          </button>
          {syncMessage && <div className="text-sm text-gray-700">{syncMessage}</div>}
          <div className="text-xs text-gray-500">
            Requires running <span className="font-mono">SUPABASE_SALES_INVENTORY_9MONTHS.sql</span> in Supabase.
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
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
          <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
            <div className="p-3 rounded border bg-indigo-50 text-black">
              <div className="font-semibold">Revenue RMSE / MAPE</div>
              <div className="mt-1">₱{Math.round(rfAnalytics.revenue.rmse).toLocaleString()} / {rfAnalytics.revenue.mape.toFixed(1)}%</div>
            </div>
            <div className="p-3 rounded border bg-blue-50 text-black">
              <div className="font-semibold">Units RMSE / MAPE</div>
              <div className="mt-1">{rfAnalytics.units.rmse.toFixed(2)} / {rfAnalytics.units.mape.toFixed(1)}%</div>
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
            onClick={runLstm}
            disabled={lstmLoading}
          >
            {lstmLoading ? "Training…" : "Run LSTM Ranking"}
          </button>
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
            <label className="block text-xs text-gray-700 mb-1">History (days)</label>
            <input
              className="w-full px-3 py-2 border rounded text-black"
              type="number"
              min={30}
              max={365}
              value={lstmDays}
              onChange={(e) => setLstmDays(Number(e.target.value || 270))}
            />
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
