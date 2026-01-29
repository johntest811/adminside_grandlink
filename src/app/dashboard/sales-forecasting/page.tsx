"use client";

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

import * as tf from "@tensorflow/tfjs";

import { RandomForestRegression as RFRegression } from "ml-random-forest";
import { trainAndForecastDailyRF, type SalesForecastOutput } from "@/app/lib/salesRandomForest";

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

  const trainSize = Math.max(1, Math.floor(X.length * 0.9));
  const XTrain = X.slice(0, trainSize);
  const yTrain = y.slice(0, trainSize);

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
    validationSplit: 0.1,
    verbose: 0,
  });

  XTrainTensor.dispose();
  yTrainTensor.dispose();

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

  return {
    horizon,
    predicted_total: preds.reduce((a, b) => a + b, 0),
    recent_total: values.slice(Math.max(0, values.length - horizon)).reduce((a, b) => a + b, 0),
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

  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const run = async () => {
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
  };

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

  const runLstm = async () => {
    try {
      setLstmLoading(true);
      setLstmError(null);
      setLstmResults(null);

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
      for (const p of products) {
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
        });
      }

      results.sort((a, b) => b.predicted_total_units - a.predicted_total_units);
      setLstmResults(results);
    } catch (e: unknown) {
      setLstmError(e instanceof Error ? e.message : String(e));
    } finally {
      setLstmLoading(false);
    }
  };

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
        <h1 className="text-2xl font-semibold text-black">Sales Forecasting</h1>
        <p className="mt-2 text-black text-sm">
          Random Forest forecasting trained on daily sales (from <span className="font-mono">/api/analytics/sales-series</span>).
        </p>

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
            <Line data={revenueChartData} options={chartOptions as any} />
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
            <Line data={qtyChartData} options={chartOptions as any} />
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

        {lstmResults && (
          <div className="overflow-x-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left">Product</th>
                  <th className="px-4 py-3 text-right">Predicted units (next)</th>
                  <th className="px-4 py-3 text-right">Recent units (last)</th>
                  <th className="px-4 py-3 text-right">Δ%</th>
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
