import { mean as ssMean, median as ssMedian, quantileSorted as ssQuantileSorted, linearRegression as ssLinearRegression, linearRegressionLine as ssLinearRegressionLine } from "simple-statistics";
export interface RegressionResult { slope: number; intercept: number; rSquared: number }

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return ssMean(values);
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  return ssMedian(values);
}

/** Mínimos quadrados ordinários; exige ao menos dois valores de X distintos. */
export function linearRegression(points: Array<[number, number]>): RegressionResult | null {
  if (points.length < 3 || new Set(points.map(([x]) => x)).size < 2) return null;
  const regression = ssLinearRegression(points);
  const line = ssLinearRegressionLine(regression);
  const meanY = ssMean(points.map(([, y]) => y));
  const total = points.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0);
  const residual = points.reduce((sum, [x, y]) => sum + (y - line(x)) ** 2, 0);
  const rSquared = total === 0 ? (residual === 0 ? 1 : 0) : Math.max(0, Math.min(1, 1 - residual / total));
  return { slope: regression.m, intercept: regression.b, rSquared };
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  return ssQuantileSorted([...values].sort((a, b) => a - b), p);
}

export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
