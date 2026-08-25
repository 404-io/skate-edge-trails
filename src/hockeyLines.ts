import type { HockeyLineColor, Point } from "./model";

export type DetectedVideoLine = {
  id: string;
  color: HockeyLineColor;
  start: Point;
  end: Point;
  score: number;
};

type PixelPoint = { x: number; y: number };

const THETA_BINS = 90;
const MAX_CANDIDATES_PER_COLOR = 4;

/**
 * Finds dominant red and blue rink-line segments in the frame. It deliberately
 * returns candidates for the skater to verify rather than guessing line names.
 */
export function detectHockeyLines(video: HTMLVideoElement): DetectedVideoLine[] {
  if (!video.videoWidth || !video.videoHeight) throw new Error("動画のサイズ情報を読み込めませんでした。");

  const maxSide = 720;
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("動画フレームを読み取れませんでした。");
  context.drawImage(video, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;

  const redPoints: PixelPoint[] = [];
  const bluePoints: PixelPoint[] = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      const color = classifyLineColor(pixels[index], pixels[index + 1], pixels[index + 2]);
      if (color === "red") redPoints.push({ x, y });
      if (color === "blue") bluePoints.push({ x, y });
    }
  }

  const red = findDominantLines(redPoints, width, height, "red");
  const blue = findDominantLines(bluePoints, width, height, "blue");
  const candidates = [...red, ...blue].sort((left, right) => right.score - left.score);
  if (candidates.length === 0) {
    throw new Error("赤線・青線の候補を見つけられませんでした。ラインが明るく大きく映るフレームで試してください。");
  }
  return candidates;
}

function classifyLineColor(red: number, green: number, blue: number): HockeyLineColor | undefined {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const chroma = maximum - minimum;
  if (maximum < 70 || chroma < 38 || chroma / maximum < 0.24) return undefined;
  const hue = hueDegrees(red / 255, green / 255, blue / 255, maximum / 255, minimum / 255);
  if (hue <= 28 || hue >= 332) return "red";
  if (hue >= 190 && hue <= 250) return "blue";
  return undefined;
}

function hueDegrees(red: number, green: number, blue: number, maximum: number, minimum: number): number {
  const chroma = maximum - minimum;
  if (chroma === 0) return 0;
  let hue = 0;
  if (maximum === red) hue = ((green - blue) / chroma) % 6;
  if (maximum === green) hue = (blue - red) / chroma + 2;
  if (maximum === blue) hue = (red - green) / chroma + 4;
  return (hue * 60 + 360) % 360;
}

function findDominantLines(points: PixelPoint[], width: number, height: number, color: HockeyLineColor): DetectedVideoLine[] {
  if (points.length < 32) return [];
  const diagonal = Math.ceil(Math.hypot(width, height));
  const rhoBins = diagonal * 2 + 1;
  const accumulator = new Uint16Array(THETA_BINS * rhoBins);
  const cosines = Array.from({ length: THETA_BINS }, (_, index) => Math.cos(index * Math.PI / THETA_BINS));
  const sines = Array.from({ length: THETA_BINS }, (_, index) => Math.sin(index * Math.PI / THETA_BINS));

  points.forEach((point) => {
    for (let theta = 0; theta < THETA_BINS; theta += 1) {
      const rho = Math.round(point.x * cosines[theta] + point.y * sines[theta]) + diagonal;
      accumulator[theta * rhoBins + rho] += 1;
    }
  });

  const result: DetectedVideoLine[] = [];
  for (let candidateIndex = 0; candidateIndex < MAX_CANDIDATES_PER_COLOR; candidateIndex += 1) {
    let bestVotes = 0;
    let bestTheta = -1;
    let bestRho = -1;
    for (let theta = 0; theta < THETA_BINS; theta += 1) {
      for (let rho = 0; rho < rhoBins; rho += 1) {
        const votes = accumulator[theta * rhoBins + rho];
        if (votes > bestVotes) {
          bestVotes = votes;
          bestTheta = theta;
          bestRho = rho;
        }
      }
    }
    if (bestVotes < Math.max(18, Math.round(points.length * 0.012))) break;

    const cosine = cosines[bestTheta];
    const sine = sines[bestTheta];
    const rho = bestRho - diagonal;
    const tangent = { x: -sine, y: cosine };
    const inliers = points.filter((point) => Math.abs(point.x * cosine + point.y * sine - rho) <= 2.8);
    if (inliers.length >= 24) {
      const projections = inliers.map((point) => point.x * tangent.x + point.y * tangent.y);
      const startProjection = Math.min(...projections);
      const endProjection = Math.max(...projections);
      const anchor = { x: rho * cosine, y: rho * sine };
      const start = { x: anchor.x + tangent.x * startProjection, y: anchor.y + tangent.y * startProjection };
      const end = { x: anchor.x + tangent.x * endProjection, y: anchor.y + tangent.y * endProjection };
      if (Math.hypot(end.x - start.x, end.y - start.y) >= Math.min(width, height) * 0.12) {
        result.push({
          id: `${color}-${candidateIndex + 1}`,
          color,
          start: { x: clamp(start.x / width), y: clamp(start.y / height) },
          end: { x: clamp(end.x / width), y: clamp(end.y / height) },
          score: bestVotes
        });
      }
    }

    for (let theta = Math.max(0, bestTheta - 3); theta <= Math.min(THETA_BINS - 1, bestTheta + 3); theta += 1) {
      for (let rhoIndex = Math.max(0, bestRho - 16); rhoIndex <= Math.min(rhoBins - 1, bestRho + 16); rhoIndex += 1) {
        accumulator[theta * rhoBins + rhoIndex] = 0;
      }
    }
  }
  return result;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
