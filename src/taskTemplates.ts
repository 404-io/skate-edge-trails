import type { EdgeCode, Foot, GuideMarker, GuideMarkerKind, GuidePrimitive, Point, TaskTemplate } from "./model";

const DOCUMENT = "2024バッジテスト規定集 本文 A4 Ver.1126C.pdf";
const SAMPLE_SPACING_M = 0.08;
// The regulation specifies a half-circle diameter of about 2-3 body heights.
// 3.6 m is a neutral default that an AR consumer can scale for its skater.
const HALF_CIRCLE_RADIUS_M = 1.8;
/** Deliberate physical break at a step; never bridge a right/left foot change. */
const FOOT_CHANGE_GAP_M = 0.22;
/** Increment used while opening a visible physical gap at a foot change. */
const FOOT_CHANGE_TRIM_STEP_RAD = 0.01;

type EdgeSpec = { edge: EdgeCode; foot: Foot };

const source = (pdfPage: number, printedPage: string) => ({ document: DOCUMENT, pdfPage, printedPage });
const radians = (degrees: number) => degrees * Math.PI / 180;
const pointEquals = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;
const pointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function arc(centerM: Point, radiusM: number, startDegrees: number, sweepDegrees: number): GuidePrimitive {
  return { kind: "arc", centerM, radiusM, startAngleRad: radians(startDegrees), sweepAngleRad: radians(sweepDegrees) };
}

function pointOnArc(item: Extract<GuidePrimitive, { kind: "arc" }>, fraction: number): Point {
  const angle = item.startAngleRad + item.sweepAngleRad * fraction;
  return { x: item.centerM.x + Math.cos(angle) * item.radiusM, y: item.centerM.y + Math.sin(angle) * item.radiusM };
}

function samplePrimitive(item: GuidePrimitive): Point[] {
  if (item.kind === "line") {
    const length = Math.hypot(item.endM.x - item.startM.x, item.endM.y - item.startM.y);
    const count = Math.max(1, Math.ceil(length / SAMPLE_SPACING_M));
    return Array.from({ length: count + 1 }, (_, index) => {
      const t = index / count;
      return { x: item.startM.x + (item.endM.x - item.startM.x) * t, y: item.startM.y + (item.endM.y - item.startM.y) * t };
    });
  }
  const count = Math.max(2, Math.ceil(Math.abs(item.sweepAngleRad) * item.radiusM / SAMPLE_SPACING_M));
  return Array.from({ length: count + 1 }, (_, index) => pointOnArc(item, index / count));
}

/** Samples only the explicit circles/lines. There is no Catmull-Rom or Bezier interpolation. */
function samplePath(primitives: GuidePrimitive[]): Point[] {
  return primitives.flatMap((item, itemIndex) => {
    const points = samplePrimitive(item);
    const previous = itemIndex === 0 ? undefined : primitives[itemIndex - 1];
    const previousEnd = previous?.kind === "arc" ? pointOnArc(previous, 1) : previous?.endM;
    return previousEnd && pointEquals(previousEnd, points[0]) ? points.slice(1) : points;
  });
}

/**
 * A chain of exact semi-circles. Each arc has endpoints separated by its
 * diameter, so a half circle cannot collapse into a shallow snaking curve.
 */
function halfCircleWave(count: number, radiusM = HALF_CIRCLE_RADIUS_M, firstSide: 1 | -1 = 1, origin: Point = { x: 0, y: 0 }): GuidePrimitive[] {
  return Array.from({ length: count }, (_, index) => {
    const side = (index % 2 === 0 ? firstSide : -firstSide);
    return arc({ x: origin.x, y: origin.y + (index * 2 + 1) * radiusM }, radiusM, -90, side * 180);
  });
}

/**
 * Two arcs with the same side meet at a deliberately sharp turn point. This
 * is used for 3-turn, bracket, counter and rocker guides instead of smoothing
 * the join into an S-curve.
 */
function turnWave(count: number, radiusM: number, firstSide: 1 | -1 = 1, origin: Point = { x: 0, y: 0 }): GuidePrimitive[] {
  return Array.from({ length: count }, (_, index) => {
    const pair = Math.floor(index / 2);
    const side: 1 | -1 = (pair % 2 === 0 ? firstSide : -firstSide) as 1 | -1;
    return arc({ x: origin.x, y: origin.y + (index * 2 + 1) * radiusM }, radiusM, -90, side * 180);
  });
}

function boundary(origin: Point, radiusM: number, index: number): Point {
  return { x: origin.x, y: origin.y + index * radiusM * 2 };
}

function marker(id: string, kind: GuideMarkerKind, label: string, positionM: Point, minimumRotations?: number): GuideMarker {
  return { id, kind, label, positionM, ...(minimumRotations ? { minimumRotations } : {}) };
}

function boundaryMarkers(id: string, kind: GuideMarkerKind, label: string, count: number, radiusM: number, origin: Point = { x: 0, y: 0 }, only: number[] = Array.from({ length: Math.max(0, count - 1) }, (_, index) => index + 1)): GuideMarker[] {
  return only.map((index) => marker(`${id}-${kind}-${index}`, kind, label, boundary(origin, radiusM, index)));
}

function markerAlongPath(id: string, kind: GuideMarkerKind, label: string, primitives: GuidePrimitive[], fraction: number, minimumRotations?: number): GuideMarker {
  const points = samplePath(primitives);
  const point = points[Math.max(0, Math.min(points.length - 1, Math.round((points.length - 1) * fraction)))];
  return marker(id, kind, label, point, minimumRotations);
}

function primitiveStart(item: GuidePrimitive): Point {
  return item.kind === "arc" ? pointOnArc(item, 0) : item.startM;
}

function primitiveEnd(item: GuidePrimitive): Point {
  return item.kind === "arc" ? pointOnArc(item, 1) : item.endM;
}

function trimArcEnd(item: Extract<GuidePrimitive, { kind: "arc" }>) {
  const sign = Math.sign(item.sweepAngleRad) || 1;
  return { ...item, sweepAngleRad: item.sweepAngleRad - sign * FOOT_CHANGE_TRIM_STEP_RAD };
}

function trimArcStart(item: Extract<GuidePrimitive, { kind: "arc" }>) {
  const sign = Math.sign(item.sweepAngleRad) || 1;
  return {
    ...item,
    startAngleRad: item.startAngleRad + sign * FOOT_CHANGE_TRIM_STEP_RAD,
    sweepAngleRad: item.sweepAngleRad - sign * FOOT_CHANGE_TRIM_STEP_RAD
  };
}

function prepareFootSubpaths(primitives: GuidePrimitive[], edges: EdgeSpec[]): GuidePrimitive[] {
  let subpathIndex = 1;
  const prepared: GuidePrimitive[] = primitives.map((primitive, index) => {
    const current = edges[index];
    const previous = edges[index - 1];
    const startsNewFoot = Boolean(index > 0 && current && previous && current.foot !== previous.foot);
    if (startsNewFoot) subpathIndex += 1;
    return { ...primitive, subpathId: `foot-${subpathIndex}` };
  });

  // A same-tangent pair can appear separated after trimming by arc length while
  // its endpoints are still only millimetres apart. Trim until the measured,
  // straight-line gap itself is at least 22 cm, so AR line renderers cannot join it.
  for (let index = 1; index < prepared.length; index += 1) {
    if (edges[index - 1]?.foot === edges[index]?.foot) continue;
    let before = prepared[index - 1];
    let after = prepared[index];
    if (before?.kind !== "arc" || after?.kind !== "arc") continue;

    while (
      pointDistance(primitiveEnd(before), primitiveStart(after)) < FOOT_CHANGE_GAP_M
      && Math.abs(before.sweepAngleRad) > FOOT_CHANGE_TRIM_STEP_RAD * 2
      && Math.abs(after.sweepAngleRad) > FOOT_CHANGE_TRIM_STEP_RAD * 2
    ) {
      before = trimArcEnd(before);
      after = trimArcStart(after);
      prepared[index - 1] = before;
      prepared[index] = after;
    }
  }

  return prepared;
}

function makeGuideSubpaths(primitives: GuidePrimitive[], edges: EdgeSpec[]) {
  const subpaths: Array<{ id: string; foot?: Foot; pointsM: Point[] }> = [];
  primitives.forEach((primitive, index) => {
    const id = primitive.subpathId ?? "foot-1";
    let active = subpaths.at(-1);
    if (!active || active.id !== id) {
      active = { id, foot: edges[index]?.foot, pointsM: [] };
      subpaths.push(active);
    }
    const points = samplePrimitive(primitive);
    active.pointsM.push(...(active.pointsM.length && pointEquals(active.pointsM.at(-1)!, points[0]) ? points.slice(1) : points));
  });
  return subpaths;
}

function footChangeMarkers(id: string, primitives: GuidePrimitive[], edges: EdgeSpec[]): GuideMarker[] {
  return edges.flatMap((item, index) => {
    if (index === 0 || edges[index - 1].foot === item.foot || !primitives[index - 1] || !primitives[index]) return [];
    const before = primitiveEnd(primitives[index - 1]);
    const after = primitiveStart(primitives[index]);
    return [marker(`${id}-foot-change-${index}`, "step", "足替え", { x: (before.x + after.x) / 2, y: (before.y + after.y) / 2 })];
  });
}

function createTemplate(id: string, title: string, taskSource: ReturnType<typeof source>, primitives: GuidePrimitive[], edges: EdgeSpec[], markers: GuideMarker[] = []): TaskTemplate {
  const pathPrimitives = prepareFootSubpaths(primitives, edges);
  return {
    id,
    title,
    source: taskSource,
    guidePath: {
      schemaVersion: 1,
      coordinateUnit: "metres",
      interpolation: "explicit-arcs-and-lines",
      sampleSpacingM: SAMPLE_SPACING_M,
      footChangeGapM: FOOT_CHANGE_GAP_M,
      primitives: pathPrimitives,
      markers: [...markers, ...footChangeMarkers(id, pathPrimitives, edges)]
    },
    guideSubpathsM: makeGuideSubpaths(pathPrimitives, edges),
    segments: edges.map((item, index) => ({
      id: `${id}-segment-${index + 1}`,
      foot: item.foot,
      subpathId: pathPrimitives[index]?.subpathId ?? "foot-1",
      startFraction: index / edges.length,
      endFraction: (index + 1) / edges.length,
      expectedEdge: item.edge,
      guidePointsM: pathPrimitives[index] ? samplePrimitive(pathPrimitives[index]) : []
    }))
  };
}

function halfCircleTemplate(id: string, title: string, taskSource: ReturnType<typeof source>, edges: EdgeSpec[], firstSide: 1 | -1 = 1): TaskTemplate {
  const primitives = halfCircleWave(edges.length, HALF_CIRCLE_RADIUS_M, firstSide);
  return createTemplate(id, title, taskSource, primitives, edges, boundaryMarkers(id, "change-edge", "チェンジ・エッジ", edges.length, HALF_CIRCLE_RADIUS_M));
}

function turnTemplate(id: string, title: string, taskSource: ReturnType<typeof source>, edges: EdgeSpec[], kind: GuideMarkerKind, label: string, firstSide: 1 | -1 = 1, turnBoundaries: number[] = [1, 3]): TaskTemplate {
  const radiusM = 1.55;
  const primitives = turnWave(edges.length, radiusM, firstSide);
  return createTemplate(id, title, taskSource, primitives, edges, boundaryMarkers(id, kind, label, edges.length, radiusM, { x: 0, y: 0 }, turnBoundaries));
}

function snakingTemplate(id: string, title: string, taskSource: ReturnType<typeof source>, edges: EdgeSpec[], firstSide: 1 | -1 = 1): TaskTemplate {
  const radiusM = 0.72;
  const primitives = halfCircleWave(edges.length, radiusM, firstSide);
  return createTemplate(id, title, taskSource, primitives, edges, boundaryMarkers(id, "change-edge", "チェンジ・エッジ", edges.length, radiusM));
}

function twizzleTemplate(id: string, title: string, taskSource: ReturnType<typeof source>, edges: EdgeSpec[], firstSide: 1 | -1 = 1): TaskTemplate {
  const radiusM = 1.2;
  const primitives = halfCircleWave(edges.length, radiusM, firstSide);
  const markers = boundaryMarkers(id, "twizzle", "ツイズル（2回転以上）", edges.length, radiusM, { x: 0, y: 0 }, [1, 3, 5]).map((item) => ({ ...item, minimumRotations: 2 }));
  return createTemplate(id, title, taskSource, primitives, edges, markers);
}

function technicalStepTemplate(id: string, title: string, firstSide: 1 | -1): TaskTemplate {
  const lower = turnWave(6, 0.72, firstSide);
  const middleStart = boundary({ x: 0, y: 0 }, 0.72, 6);
  const middle = turnWave(6, 1.02, (-firstSide) as 1 | -1, middleStart);
  const upperStart = boundary(middleStart, 1.02, 6);
  const upper = turnWave(5, 1.3, firstSide, upperStart);
  const primitives = [...lower, ...middle, ...upper];
  const names: Array<[GuideMarkerKind, string]> = [
    ["step", "1 クロスロール"], ["twizzle", "2 ツイズル"], ["loop", "3 ループ"], ["bracket", "4 ブラケット・スリー"],
    ["twizzle", "5 ツイズル"], ["choctaw", "6 スライド・チョクトー"], ["choctaw", "7 オープン・チョクトー"], ["choctaw", "8 チョクトー"],
    ["mohawk", "9 オープンモホーク"], ["rocker", "10 ロッカー"], ["step", "11 ストローク"], ["step", "12 クロスシャッセ"],
    ["counter", "13 カウンター"], ["choctaw", "14 スウィング・クローズド・チョクトー"], ["three-turn", "15 スリー"],
    ["loop", "16 スプレッドイーグル"], ["loop", "17 ループ"]
  ];
  const markers = names.map(([kind, label], index) => markerAlongPath(`${id}-step-${index + 1}`, kind, label, primitives, (index + 1) / (names.length + 1), kind === "twizzle" ? 2 : undefined));
  return createTemplate(id, title, source(52, "50"), primitives, [], markers);
}

const S39 = source(41, "39");
const S40 = source(42, "40");
const S41 = source(43, "41");
const S42 = source(44, "42");
const S43 = source(45, "43");
const S44 = source(46, "44");
const S45 = source(47, "45");
const S46 = source(48, "46");
const S47 = source(49, "47");
const S48 = source(50, "48");
const S49 = source(51, "49");

export const TASK_TEMPLATES: TaskTemplate[] = [
  // 1級 - PDF 39-40
  halfCircleTemplate("badge-1-forward-change-half-circle-right", "1級 フォア・チェンジ・ハーフ・サークル（右足スタート）", S39, [
    { edge: "RFO", foot: "right" }, { edge: "RFI", foot: "right" }, { edge: "LFI", foot: "left" }, { edge: "LFO", foot: "left" }
  ]),
  halfCircleTemplate("badge-1-forward-change-half-circle-left", "1級 フォア・チェンジ・ハーフ・サークル（左足スタート）", S39, [
    { edge: "LFO", foot: "left" }, { edge: "LFI", foot: "left" }, { edge: "RFI", foot: "right" }, { edge: "RFO", foot: "right" }
  ], -1),
  turnTemplate("badge-1-waltz-three-step", "1級 ワルツ（スリー）・ステップ", S39, [
    { edge: "RFO", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }
  ], "three-turn", "スリー・ターン", 1, [1, 3]),
  turnTemplate("badge-1-back-cross-forward-out-right", "1級 バック・クロスとフォア・アウト・エッジ（右回り）", S40, [
    { edge: "RBI", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "RFO", foot: "right" }, { edge: "LBI", foot: "left" }
  ], "step", "バック・クロス", 1, [2]),
  turnTemplate("badge-1-back-cross-forward-out-left", "1級 バック・クロスとフォア・アウト・エッジ（左回り）", S40, [
    { edge: "LBO", foot: "left" }, { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "RBI", foot: "right" }
  ], "step", "バック・クロス", -1, [2]),

  // 2級 - PDF 41-42
  turnTemplate("badge-2-forward-out-three", "2級 フォア・アウトのスリー・ターン・ステップ", S41, [
    { edge: "RFO", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "LBI", foot: "left" }
  ], "three-turn", "スリー・ターン"),
  turnTemplate("badge-2-forward-in-three", "2級 フォア・インのスリー・ターン・ステップ", S41, [
    { edge: "RFI", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "LFI", foot: "left" }, { edge: "LBO", foot: "left" }
  ], "three-turn", "スリー・ターン", -1),
  turnTemplate("badge-2-forward-out-double-three", "2級 フォア・アウトのダブルスリー・ステップ", S41, [
    { edge: "RFO", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "LFO", foot: "left" }
  ], "three-turn", "ダブル・スリー", 1, [1, 2, 4, 5]),
  turnTemplate("badge-2-forward-in-double-three", "2級 フォア・インのダブルスリー・ステップ", S41, [
    { edge: "RFI", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "RFI", foot: "right" }, { edge: "LFI", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "LFI", foot: "left" }
  ], "three-turn", "ダブル・スリー", -1, [1, 2, 4, 5]),
  turnTemplate("badge-2-back-three-mohawk", "2級 バックのスリー・ターンとモホークのパワー・ステップ", S42, [
    { edge: "RBO", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "LBO", foot: "left" }
  ], "mohawk", "モホーク", 1, [2]),

  // 3級 - PDF 43-45
  halfCircleTemplate("badge-3-back-change-half-circle-right", "3級 バック・チェンジ・ハーフ・サークル（右足スタート）", S43, [
    { edge: "RBO", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "LBO", foot: "left" }
  ]),
  halfCircleTemplate("badge-3-back-change-half-circle-left", "3級 バック・チェンジ・ハーフ・サークル（左足スタート）", S43, [
    { edge: "LBO", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "RBO", foot: "right" }
  ], -1),
  turnTemplate("badge-3-bracket-out-right", "3級 ブラケット・ターンのステップ（アウト・右足スタート）", S44, [
    { edge: "RFO", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "LFO", foot: "left" }
  ], "bracket", "ブラケット・ターン", -1),
  turnTemplate("badge-3-bracket-out-left", "3級 ブラケット・ターンのステップ（アウト・左足スタート）", S44, [
    { edge: "LFO", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "RFO", foot: "right" }
  ], "bracket", "ブラケット・ターン", 1),
  turnTemplate("badge-3-bracket-in-right", "3級 ブラケット・ターンのステップ（イン・右足スタート）", S44, [
    { edge: "RFI", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "LFI", foot: "left" }
  ], "bracket", "ブラケット・ターン", -1),
  turnTemplate("badge-3-bracket-in-left", "3級 ブラケット・ターンのステップ（イン・左足スタート）", S44, [
    { edge: "LFI", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }, { edge: "RFI", foot: "right" }
  ], "bracket", "ブラケット・ターン", 1),
  snakingTemplate("badge-3-one-foot-snaking-forward-right", "3級 ワンフット・スネーキング（フォア・右足スタート）", S45, [
    { edge: "RFO", foot: "right" }, { edge: "RFI", foot: "right" }, { edge: "RFO", foot: "right" }, { edge: "RFI", foot: "right" }, { edge: "RFO", foot: "right" }, { edge: "RFI", foot: "right" }
  ]),
  snakingTemplate("badge-3-one-foot-snaking-forward-left", "3級 ワンフット・スネーキング（フォア・左足スタート）", S45, [
    { edge: "LFO", foot: "left" }, { edge: "LFI", foot: "left" }, { edge: "LFO", foot: "left" }, { edge: "LFI", foot: "left" }, { edge: "LFO", foot: "left" }, { edge: "LFI", foot: "left" }
  ], -1),
  snakingTemplate("badge-3-one-foot-snaking-back-right", "3級 ワンフット・スネーキング（バック・右足スタート）", S45, [
    { edge: "RBO", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "RBI", foot: "right" }
  ]),
  snakingTemplate("badge-3-one-foot-snaking-back-left", "3級 ワンフット・スネーキング（バック・左足スタート）", S45, [
    { edge: "LBO", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "LBI", foot: "left" }
  ], -1),

  // 4級 - PDF 46-47
  turnTemplate("badge-4-open-choctaw-three", "4級 オープン・チョクトーとスリー・ターンのステップ", S46, [
    { edge: "RFI", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }, { edge: "LFI", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "RFI", foot: "right" }
  ], "choctaw", "オープン・チョクトー", 1, [1, 3]),
  turnTemplate("badge-4-toe-step", "4級 トゥ・ステップ", S46, [
    { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }
  ], "toe-step", "トゥ（2回転以上）", 1, [1, 2, 3]),
  twizzleTemplate("badge-4-twizzle-forward-out", "4級 ツイズル・ステップ フォア（アウト）", S47, [
    { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }, { edge: "RFO", foot: "right" }, { edge: "LFO", foot: "left" }
  ]),
  twizzleTemplate("badge-4-twizzle-forward-in", "4級 ツイズル・ステップ フォア（イン）", S47, [
    { edge: "RFI", foot: "right" }, { edge: "LFI", foot: "left" }, { edge: "RFI", foot: "right" }, { edge: "LFI", foot: "left" }, { edge: "RFI", foot: "right" }, { edge: "LFI", foot: "left" }
  ], -1),
  twizzleTemplate("badge-4-twizzle-back-out", "4級 ツイズル・ステップ バック（アウト）", S47, [
    { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }
  ]),
  twizzleTemplate("badge-4-twizzle-back-in", "4級 ツイズル・ステップ バック（イン）", S47, [
    { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }
  ], -1),

  // 5級 - PDF 48-50
  turnTemplate("badge-5-counter-out-right", "5級 アウト・カウンター・ターンのステップ（右足スタート）", S48, [
    { edge: "RFO", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "LFO", foot: "left" }
  ], "counter", "カウンター・ターン"),
  turnTemplate("badge-5-counter-out-left", "5級 アウト・カウンター・ターンのステップ（左足スタート）", S48, [
    { edge: "LFO", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }, { edge: "RFO", foot: "right" }
  ], "counter", "カウンター・ターン", -1),
  turnTemplate("badge-5-counter-in-right", "5級 イン・カウンター・ターンのステップ（右足スタート）", S48, [
    { edge: "RFI", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "LFI", foot: "left" }
  ], "counter", "カウンター・ターン"),
  turnTemplate("badge-5-counter-in-left", "5級 イン・カウンター・ターンのステップ（左足スタート）", S48, [
    { edge: "LFI", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "RFI", foot: "right" }
  ], "counter", "カウンター・ターン", -1),
  turnTemplate("badge-5-rocker-out-right", "5級 アウト・ロッカー・ターンのステップ（右足スタート）", S49, [
    { edge: "RFO", foot: "right" }, { edge: "RBO", foot: "right" }, { edge: "LBO", foot: "left" }, { edge: "LFO", foot: "left" }
  ], "rocker", "ロッカー・ターン"),
  turnTemplate("badge-5-rocker-out-left", "5級 アウト・ロッカー・ターンのステップ（左足スタート）", S49, [
    { edge: "LFO", foot: "left" }, { edge: "LBO", foot: "left" }, { edge: "RBO", foot: "right" }, { edge: "RFO", foot: "right" }
  ], "rocker", "ロッカー・ターン", -1),
  turnTemplate("badge-5-rocker-in-right", "5級 イン・ロッカー・ターンのステップ（右足スタート）", S49, [
    { edge: "RFI", foot: "right" }, { edge: "RBI", foot: "right" }, { edge: "LBI", foot: "left" }, { edge: "LFI", foot: "left" }
  ], "rocker", "ロッカー・ターン"),
  turnTemplate("badge-5-rocker-in-left", "5級 イン・ロッカー・ターンのステップ（左足スタート）", S49, [
    { edge: "LFI", foot: "left" }, { edge: "LBI", foot: "left" }, { edge: "RBI", foot: "right" }, { edge: "RFI", foot: "right" }
  ], "rocker", "ロッカー・ターン", -1),
  technicalStepTemplate("badge-5-technical-step-right", "5級 テクニカル・ステップ（右足スタート）", 1),
  technicalStepTemplate("badge-5-technical-step-left", "5級 テクニカル・ステップ（左足スタート）", -1)
];

export const EDGE_CODES: EdgeCode[] = ["LFO", "LFI", "LBO", "LBI", "RFO", "RFI", "RBO", "RBI"];