import * as tf from "@tensorflow/tfjs";

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

export async function trainAndForecastDemandLSTM(params: {
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

  for (let t = lookback; t < norm.length; t += 1) {
    const window: number[][] = [];
    for (let i = t - lookback; i < t; i += 1) {
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

  let windowValues = norm.slice(norm.length - lookback);
  let windowDates = labels.slice(labels.length - lookback);
  const lastDate = labels[labels.length - 1];
  const preds: number[] = [];
  for (let i = 1; i <= horizon; i += 1) {
    const seq = windowValues.map((q, idx) => {
      const [ms, mc] = monthSinCos(windowDates[idx]);
      return [q, ms, mc];
    });
    const tensor = tf.tensor3d([seq], [1, lookback, 3]);
    const pred = model.predict(tensor) as tf.Tensor;
    const nextNorm = (await pred.data())[0];
    tensor.dispose();
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
