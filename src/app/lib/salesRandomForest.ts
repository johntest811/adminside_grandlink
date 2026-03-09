export type SalesSeries = {
  labels: string[]; // YYYY-MM-DD
  values: number[];
};

export type SalesForecastOutput = {
  labels: string[];
  actual: number[];
  forecast: number[];
  maeBacktest: number;
  meta: {
    trainSamples: number;
    lookback: number;
    horizon: number;
    backtestDays: number;
  };
};

type ZNorm = {
  mean: number;
  std: number;
  norm: (v: number) => number;
  denorm: (v: number) => number;
};

function zNormalize(values: number[]): ZNorm {
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
    norm: (v) => (v - mean) / std,
    denorm: (v) => v * std + mean,
  };
}

function mae(actual: number[], predicted: number[]) {
  const n = Math.min(actual.length, predicted.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((actual[i] || 0) - (predicted[i] || 0));
  return sum / n;
}

function addDaysISO(dateISO: string, days: number) {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function getDateFeatures(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0-6
  const month = d.getUTCMonth(); // 0-11
  return {
    dowNorm: dow / 6,
    monthNorm: month / 11,
  };
}

export function summarizeForecastDelta(opts: {
  actual: number[];
  forecast: number[];
  horizon: number;
}) {
  const { actual, forecast, horizon } = opts;
  const actualClean = actual.filter((v) => Number.isFinite(v));

  const n = actualClean.length;
  const recentWindow = Math.min(horizon, n);
  const recentActual = actualClean.slice(Math.max(0, n - recentWindow));
  const recentSum = recentActual.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  const futureForecast = forecast.slice(Math.max(0, forecast.length - horizon));
  const futureSum = futureForecast.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  const pctChange = recentSum > 0 ? (futureSum - recentSum) / recentSum : 0;
  return { recentSum, futureSum, pctChange };
}

export async function trainAndForecastDailyRF(params: {
  rf: any; // RandomForestRegression
  series: SalesSeries;
  lookback: number;
  horizon: number;
  backtestDays: number;
}): Promise<SalesForecastOutput> {
  const { rf, series } = params;
  const lookback = Math.max(3, Math.min(60, Math.floor(params.lookback)));
  const horizon = Math.max(1, Math.min(90, Math.floor(params.horizon)));
  const backtestDays = Math.max(7, Math.min(60, Math.floor(params.backtestDays)));

  const labels = series.labels;
  const cleanValues = series.values.map((v) => (Number.isFinite(v) ? Number(v) : 0));

  if (labels.length !== cleanValues.length) throw new Error("Sales series shape mismatch");
  if (cleanValues.length < lookback + backtestDays + 10) throw new Error("Not enough history to train");

  const zn = zNormalize(cleanValues);
  const norm = cleanValues.map(zn.norm);

  const X: number[][] = [];
  const y: number[] = [];

  for (let t = lookback; t < norm.length; t++) {
    const lags = norm.slice(t - lookback, t);
    const { dowNorm, monthNorm } = getDateFeatures(labels[t]);
    const tNorm = t / (norm.length - 1);
    X.push([...lags, dowNorm, monthNorm, tNorm]);
    y.push(norm[t]);
  }

  const testSize = Math.min(backtestDays, y.length - 5);
  const trainSize = y.length - testSize;
  if (trainSize < 20) throw new Error("Not enough training samples");

  const XTrain = X.slice(0, trainSize);
  const yTrain = y.slice(0, trainSize);
  const XTest = X.slice(trainSize);
  const yTest = y.slice(trainSize);

  rf.train(XTrain, yTrain);

  const testPredNorm = XTest.length ? (rf.predict(XTest) as number[]) : [];
  const maeBacktest = mae(yTest.map(zn.denorm), testPredNorm.map(zn.denorm));

  let window = norm.slice(norm.length - lookback);
  const lastDate = labels[labels.length - 1];

  const futureLabels: string[] = [];
  const futurePred: number[] = [];
  for (let i = 1; i <= horizon; i++) {
    const date = addDaysISO(lastDate, i);
    futureLabels.push(date);
    const { dowNorm, monthNorm } = getDateFeatures(date);
    const tNorm = (norm.length - 1 + i) / (norm.length - 1 + horizon);
    const feat = [...window, dowNorm, monthNorm, tNorm];
    const nextNorm = (rf.predict([feat]) as number[])[0];
    futurePred.push(zn.denorm(nextNorm));
    window = window.slice(1).concat(nextNorm);
  }

  return {
    labels: labels.concat(futureLabels),
    actual: cleanValues.concat(new Array(horizon).fill(NaN)),
    forecast: new Array(cleanValues.length).fill(NaN).concat(futurePred),
    maeBacktest,
    meta: { trainSamples: XTrain.length, lookback, horizon, backtestDays },
  };
}
