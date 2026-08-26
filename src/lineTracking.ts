import type { FrameCalibration, Point } from "./model";

type GrayFrame = {
  width: number;
  height: number;
  values: Uint8Array;
};

type Template = {
  halfSize: number;
  values: Float32Array;
};

type PixelPoint = { x: number; y: number };

export type RinkLineTracker = {
  track(timestampMs: number): FrameCalibration | undefined;
};

const TEMPLATE_HALF_SIZE = 6;
const MIN_SCORE = 0.48;

/**
 * Tracks four visible, manually selected image features. The points can be
 * hockey-line crossings, line-to-board contacts, or other stable high-contrast
 * marks; their order is correspondence order, not a screen-space polygon.
 */
export function createRinkLineTracker(video: HTMLVideoElement, referencePoints: Point[]): RinkLineTracker {
  if (referencePoints.length !== 4) throw new Error("移動カメラ補正には、画面内の追跡点を4点指定してください。");
  if (!isPlausibleConfiguration(referencePoints)) {
    throw new Error("追跡点は、一直線を避けて画面内に広く4点指定してください。");
  }
  if (!video.videoWidth || !video.videoHeight) throw new Error("動画のサイズ情報を読み込めませんでした。");

  const longSide = 640;
  const scale = Math.min(1, longSide / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("動画フレームを読み取れませんでした。");

  const readFrame = () => {
    context.drawImage(video, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    const values = new Uint8Array(width * height);
    for (let index = 0, pixel = 0; index < values.length; index += 1, pixel += 4) {
      values[index] = Math.round(rgba[pixel] * 0.299 + rgba[pixel + 1] * 0.587 + rgba[pixel + 2] * 0.114);
    }
    return { width, height, values } satisfies GrayFrame;
  };

  const reference = readFrame();
  const initialPixels = referencePoints.map((point) => ({ x: point.x * width, y: point.y * height }));
  const templates = initialPixels.map((point) => makeTemplate(reference, point));
  let previous = initialPixels;
  const searchRadius = Math.max(16, Math.min(44, Math.round(Math.min(width, height) * 0.07)));

  return {
    track(timestampMs) {
      const frame = readFrame();
      const matches = templates.map((template, index) => findBestMatch(frame, template, previous[index], searchRadius));
      if (matches.some((match) => !match || match.score < MIN_SCORE)) return undefined;

      const confidentMatches = matches as Array<PixelPoint & { score: number }>;
      const imageCorners = confidentMatches.map((match) => ({ x: match.x / width, y: match.y / height }));
      if (!isPlausibleConfiguration(imageCorners)) return undefined;

      previous = confidentMatches.map(({ x, y }) => ({ x, y }));
      return {
        timestampMs,
        imageCorners,
        confidence: confidentMatches.reduce((sum, match) => sum + match.score, 0) / confidentMatches.length
      };
    }
  };
}

function makeTemplate(frame: GrayFrame, center: PixelPoint): Template {
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  if (!isPatchInside(frame, x, y, TEMPLATE_HALF_SIZE)) {
    throw new Error("追跡点は映像端から離して、ラインの交点や模様がある位置を選んでください。");
  }

  const side = TEMPLATE_HALF_SIZE * 2 + 1;
  const raw = new Float32Array(side * side);
  let sum = 0;
  let index = 0;
  for (let dy = -TEMPLATE_HALF_SIZE; dy <= TEMPLATE_HALF_SIZE; dy += 1) {
    for (let dx = -TEMPLATE_HALF_SIZE; dx <= TEMPLATE_HALF_SIZE; dx += 1) {
      const value = frame.values[(y + dy) * frame.width + x + dx];
      raw[index] = value;
      sum += value;
      index += 1;
    }
  }

  const mean = sum / raw.length;
  let squaredLength = 0;
  raw.forEach((value, valueIndex) => {
    raw[valueIndex] = value - mean;
    squaredLength += raw[valueIndex] ** 2;
  });
  if (squaredLength < 1_000) throw new Error("追跡点の近くに十分な模様がありません。ラインの交点やボードとの接点を選んでください。");
  const length = Math.sqrt(squaredLength);
  raw.forEach((value, valueIndex) => {
    raw[valueIndex] = value / length;
  });
  return { halfSize: TEMPLATE_HALF_SIZE, values: raw };
}

function findBestMatch(frame: GrayFrame, template: Template, prediction: PixelPoint, radius: number): (PixelPoint & { score: number }) | undefined {
  const centerX = Math.round(prediction.x);
  const centerY = Math.round(prediction.y);
  const minX = Math.max(template.halfSize, centerX - radius);
  const maxX = Math.min(frame.width - template.halfSize - 1, centerX + radius);
  const minY = Math.max(template.halfSize, centerY - radius);
  const maxY = Math.min(frame.height - template.halfSize - 1, centerY + radius);
  let best: (PixelPoint & { score: number }) | undefined;

  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const score = normalizedCorrelation(frame, template, x, y);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (!best) return undefined;

  const refineMinX = Math.max(template.halfSize, best.x - 2);
  const refineMaxX = Math.min(frame.width - template.halfSize - 1, best.x + 2);
  const refineMinY = Math.max(template.halfSize, best.y - 2);
  const refineMaxY = Math.min(frame.height - template.halfSize - 1, best.y + 2);
  for (let y = refineMinY; y <= refineMaxY; y += 1) {
    for (let x = refineMinX; x <= refineMaxX; x += 1) {
      const score = normalizedCorrelation(frame, template, x, y);
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}

function normalizedCorrelation(frame: GrayFrame, template: Template, centerX: number, centerY: number): number {
  const side = template.halfSize * 2 + 1;
  const count = side * side;
  let sum = 0;
  for (let dy = -template.halfSize; dy <= template.halfSize; dy += 1) {
    for (let dx = -template.halfSize; dx <= template.halfSize; dx += 1) {
      sum += frame.values[(centerY + dy) * frame.width + centerX + dx];
    }
  }

  const mean = sum / count;
  let squaredLength = 0;
  let dot = 0;
  let index = 0;
  for (let dy = -template.halfSize; dy <= template.halfSize; dy += 1) {
    for (let dx = -template.halfSize; dx <= template.halfSize; dx += 1) {
      const centered = frame.values[(centerY + dy) * frame.width + centerX + dx] - mean;
      squaredLength += centered ** 2;
      dot += centered * template.values[index];
      index += 1;
    }
  }
  return squaredLength < 1_000 ? -1 : dot / Math.sqrt(squaredLength);
}

function isPatchInside(frame: GrayFrame, x: number, y: number, halfSize: number): boolean {
  return x - halfSize >= 0 && y - halfSize >= 0 && x + halfSize < frame.width && y + halfSize < frame.height;
}

function isPlausibleConfiguration(points: Point[]): boolean {
  if (points.length !== 4 || points.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1)) return false;
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) {
      if (Math.hypot(points[first].x - points[second].x, points[first].y - points[second].y) < 0.012) return false;
    }
  }
  const hull = convexHull(points);
  return hull.length >= 3 && Math.abs(polygonArea(hull)) > 0.004;
}

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const cross = (origin: Point, first: Point, second: Point) =>
    (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
  const lower: Point[] = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper: Point[] = [];
  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  });
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function polygonArea(points: Point[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - point.y * next.x;
  }, 0) / 2;
}
