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

import {
  DEFAULT_LOCATIONS,
  fetchHistoricalWeather,
  makeLaggedDataset,
  mae,
  zNormalize,
  type WeatherLocation,
} from "@/app/lib/weatherForecast";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

type ForecastResult = {
  labels: string[];
  actual: number[];
  lstmPred: number[];
  rfPred: number[];
  maeLstm: number;
  maeRf: number;
};

const LOOKBACK = 24;
const FORECAST_HOURS = 24;

async function trainAndForecastTemperature(values: number[]): Promise<ForecastResult> {
  // Use last portion for evaluation and next-step forecasting.
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < LOOKBACK + 48) throw new Error("Not enough data to train");

  // Normalize for LSTM stability.
  const zn = zNormalize(clean);
  const { X, y } = makeLaggedDataset(zn.norm, LOOKBACK);

  // Train/test split indices (simple).
  const trainSize = Math.max(1, Math.floor(X.length * 0.85));
  const XTrain = X.slice(0, trainSize);
  const yTrain = y.slice(0, trainSize);
  const XTest = X.slice(trainSize);
  const yTest = y.slice(trainSize);

  // -------------------- Random Forest --------------------
  const rf = new RFRegression({
    nEstimators: 80,
    maxFeatures: Math.max(1, Math.floor(Math.sqrt(LOOKBACK))),
    replacement: true,
    seed: 42,
  });
  rf.train(XTrain, yTrain);
  const rfTestPredNorm = XTest.length ? (rf.predict(XTest) as number[]) : [];

  // -------------------- LSTM --------------------
  const model = tf.sequential();
  model.add(
    tf.layers.lstm({
      units: 32,
      inputShape: [LOOKBACK, 1],
      returnSequences: false,
    })
  );
  model.add(tf.layers.dense({ units: 1 }));
  model.compile({ optimizer: tf.train.adam(0.01), loss: "meanSquaredError" });

  const XTrainTensor = tf.tensor3d(
    XTrain.map((row) => row.map((v) => [v])),
    [XTrain.length, LOOKBACK, 1]
  );
  const yTrainTensor = tf.tensor2d(yTrain, [yTrain.length, 1]);

  await model.fit(XTrainTensor, yTrainTensor, {
    epochs: 12,
    batchSize: 32,
    shuffle: true,
    validationSplit: 0.1,
    verbose: 0,
  });

  XTrainTensor.dispose();
  yTrainTensor.dispose();

  const XTestTensor = tf.tensor3d(
    XTest.map((row) => row.map((v) => [v])),
    [XTest.length, LOOKBACK, 1]
  );
  const lstmTestPredTensor = XTest.length ? (model.predict(XTestTensor) as tf.Tensor) : null;
  const lstmTestPredNorm = lstmTestPredTensor ? Array.from(await lstmTestPredTensor.data()) : [];
  XTestTensor.dispose();
  lstmTestPredTensor?.dispose();

  // Denormalize predictions
  const yTestDenorm = yTest.map(zn.denorm);
  const rfTestPred = rfTestPredNorm.map(zn.denorm);
  const lstmTestPred = lstmTestPredNorm.map(zn.denorm);

  const maeRf = mae(yTestDenorm, rfTestPred);
  const maeLstm = mae(yTestDenorm, lstmTestPred);

  // Forecast next FORECAST_HOURS iteratively from last observed window.
  const lastWindow = zn.norm.slice(zn.norm.length - LOOKBACK);
  const rfFutureNorm: number[] = [];
  const lstmFutureNorm: number[] = [];

  // RF future
  let rfWindow = lastWindow.slice();
  for (let i = 0; i < FORECAST_HOURS; i++) {
    const next = (rf.predict([rfWindow]) as number[])[0];
    rfFutureNorm.push(next);
    rfWindow = rfWindow.slice(1).concat(next);
  }

  // LSTM future
  let lstmWindow = lastWindow.slice();
  for (let i = 0; i < FORECAST_HOURS; i++) {
    const t = tf.tensor3d([lstmWindow.map((v) => [v])], [1, LOOKBACK, 1]);
    const pred = model.predict(t) as tf.Tensor;
    const next = (await pred.data())[0];
    lstmFutureNorm.push(next);
    t.dispose();
    pred.dispose();
    lstmWindow = lstmWindow.slice(1).concat(next);
  }

  model.dispose();

  // Build chart series: last 48 actual + 24 forecast.
  const tailActual = clean.slice(clean.length - 48);

  const labels: string[] = [];
  for (let i = clean.length - 48; i < clean.length + FORECAST_HOURS; i++) {
    labels.push(i < clean.length ? `t${i - (clean.length - 48) - 48}` : `t+${i - (clean.length - 1)}`);
  }

  const rfPred = new Array(48).fill(NaN).concat(rfFutureNorm.map(zn.denorm));
  const lstmPred = new Array(48).fill(NaN).concat(lstmFutureNorm.map(zn.denorm));

  return {
    labels,
    actual: tailActual.concat(new Array(FORECAST_HOURS).fill(NaN)),
    rfPred,
    lstmPred,
    maeRf,
    maeLstm,
  };
}

export default function PredictivePage() {
  const [location, setLocation] = useState<WeatherLocation>(DEFAULT_LOCATIONS[0]);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForecastResult | null>(null);

  const canRun = useMemo(() => days >= 7 && days <= 365, [days]);

  const runForecast = async () => {
    try {
      setLoading(true);
      setError(null);
      setResult(null);

      const series = await fetchHistoricalWeather(location, days);
      const r = await trainAndForecastTemperature(series.temperature);
      setResult(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!result) return null;
    return {
      labels: result.labels,
      datasets: [
        {
          label: "Actual (last 48h)",
          data: result.actual,
          borderColor: "#111827",
          backgroundColor: "rgba(17,24,39,0.15)",
          spanGaps: true,
        },
        {
          label: "LSTM Forecast (next 24h)",
          data: result.lstmPred,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37,99,235,0.15)",
          spanGaps: true,
        },
        {
          label: "Random Forest Forecast (next 24h)",
          data: result.rfPred,
          borderColor: "#16a34a",
          backgroundColor: "rgba(22,163,74,0.15)",
          spanGaps: true,
        },
      ],
    };
  }, [result]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Predictive Weather Forecasting</h1>
        <p className="text-sm text-gray-300 mt-1">
          Trains an LSTM and a Random Forest on historical hourly temperature, then forecasts the next 24 hours.
        </p>
      </div>

      <div className="rounded-lg bg-[#0f172a] border border-white/10 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-gray-300 mb-1">Location</label>
            <select
              className="w-full rounded border border-white/10 bg-[#111827] text-white px-3 py-2"
              value={location.name}
              onChange={(e) => {
                const loc = DEFAULT_LOCATIONS.find((l) => l.name === e.target.value);
                if (loc) setLocation(loc);
              }}
            >
              {DEFAULT_LOCATIONS.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-300 mb-1">Training window (days)</label>
            <input
              type="number"
              min={7}
              max={365}
              className="w-full rounded border border-white/10 bg-[#111827] text-white px-3 py-2"
              value={days}
              onChange={(e) => setDays(Number(e.target.value || 90))}
            />
            {!canRun && <div className="text-xs text-red-300 mt-1">Choose 7–365 days.</div>}
          </div>

          <div className="flex items-end">
            <button
              className="w-full rounded bg-[#8B1C1C] px-4 py-2 text-white font-semibold disabled:opacity-50"
              disabled={loading || !canRun}
              onClick={runForecast}
            >
              {loading ? "Training…" : "Run Forecast"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-gray-300">MAE (LSTM)</div>
              <div className="text-white font-semibold">{result.maeLstm.toFixed(2)} °C</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-gray-300">MAE (Random Forest)</div>
              <div className="text-white font-semibold">{result.maeRf.toFixed(2)} °C</div>
            </div>
            <div className="rounded border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-gray-300">Forecast horizon</div>
              <div className="text-white font-semibold">{FORECAST_HOURS} hours</div>
            </div>
          </div>
        )}

        {chartData && (
          <div className="mt-6 rounded border border-white/10 bg-white p-3">
            <Line
              data={chartData}
              options={{
                responsive: true,
                plugins: {
                  legend: { position: "top" as const },
                  title: { display: true, text: "Temperature Forecast" },
                },
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
