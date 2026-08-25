import type { Calibration, FootSample, FrameCalibration, MetricSample, Point, TravelDirection } from "./model";

type Matrix3 = [number, number, number, number, number, number, number, number, number];

type ProjectedFootSample = {
  sample: FootSample;
  toeM: Point;
  heelM: Point;
};

const EPSILON = 1e-8;

function solveLinearSystem(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < EPSILON) throw new Error("校正点が近すぎるか、一直線上にあります。");
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let index = column; index <= n; index += 1) augmented[column][index] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= n; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }

  return augmented.map((row) => row[n]);
}

/** Creates a projective transform from normalized video coordinates to metres on the ice. */
export function makeHomography(calibration: Calibration): Matrix3 {
  if (calibration.imageCorners.length !== 4) throw new Error("校正点を4点指定してください。");
  const targets: Point[] = [
    { x: 0, y: 0 },
    { x: calibration.widthM, y: 0 },
    { x: calibration.widthM, y: calibration.lengthM },
    { x: 0, y: calibration.lengthM }
  ];

  const rows: number[][] = [];
  const values: number[] = [];
  calibration.imageCorners.forEach((source, index) => {
    const target = targets[index];
    rows.push([source.x, source.y, 1, 0, 0, 0, -source.x * target.x, -source.y * target.x]);
    values.push(target.x);
    rows.push([0, 0, 0, source.x, source.y, 1, -source.x * target.y, -source.y * target.y]);
    values.push(target.y);
  });

  const [a, b, c, d, e, f, g, h] = solveLinearSystem(rows, values);
  return [a, b, c, d, e, f, g, h, 1];
}

export function project(point: Point, matrix: Matrix3): Point {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const denominator = g * point.x + h * point.y + i;
  if (Math.abs(denominator) < EPSILON) throw new Error("校正範囲の外にある点です。");
  return {
    x: (a * point.x + b * point.y + c) / denominator,
    y: (d * point.x + e * point.y + f) / denominator
  };
}

function normalize(point: Point): Point {
  const length = Math.hypot(point.x, point.y);
  return length < EPSILON ? { x: 0, y: 0 } : { x: point.x / length, y: point.y / length };
}

function travelDirection(samples: ProjectedFootSample[], index: number): TravelDirection {
  const before = samples[Math.max(0, index - 2)];
  const after = samples[Math.min(samples.length - 1, index + 2)];
  const movement = normalize({ x: after.toeM.x - before.toeM.x, y: after.toeM.y - before.toeM.y });
  const current = samples[index];
  const blade = normalize({ x: current.toeM.x - current.heelM.x, y: current.toeM.y - current.heelM.y });
  const dot = movement.x * blade.x + movement.y * blade.y;
  if (Math.abs(dot) < 0.28) return "?";
  return dot > 0 ? "F" : "B";
}

/**
 * Converts feet to rink metres. When frame calibrations are supplied, each
 * timestamp is projected with its own homography anchored to the rink lines.
 */
export function makeMetricSamples(
  samples: FootSample[],
  calibration: Calibration,
  frameCalibrations?: FrameCalibration[]
): MetricSample[] {
  const staticMatrix = frameCalibrations ? undefined : makeHomography(calibration);
  const frameMatrices = new Map<number, Matrix3>();
  frameCalibrations?.forEach((frame) => {
    try {
      frameMatrices.set(frame.timestampMs, makeHomography({ ...calibration, imageCorners: frame.imageCorners }));
    } catch {
      // A bad line match is ignored instead of contaminating the trajectory.
    }
  });

  const projected = samples
    .filter((sample) => sample.visibility >= 0.55)
    .flatMap((sample) => {
      const matrix = staticMatrix ?? frameMatrices.get(sample.timestampMs);
      if (!matrix) return [];
      try {
        return [{ sample, toeM: project(sample.toe, matrix), heelM: project(sample.heel, matrix) }];
      } catch {
        return [];
      }
    });

  return projected.map((current, index) => ({
    ...current.sample,
    positionM: current.toeM,
    direction: travelDirection(projected, index)
  }));
}

export function simplify(points: MetricSample[], minDistanceM = 0.025): MetricSample[] {
  return points.reduce<MetricSample[]>((result, point) => {
    const previous = result.at(-1);
    if (!previous || Math.hypot(point.positionM.x - previous.positionM.x, point.positionM.y - previous.positionM.y) >= minDistanceM) {
      result.push(point);
    }
    return result;
  }, []);
}
