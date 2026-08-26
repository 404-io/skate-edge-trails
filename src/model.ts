export type Point = { x: number; y: number };

/**
 * A guide is deliberately expressed as physical primitives, not as a spline.
 * This lets an AR client render a half circle as an actual circular arc and
 * preserve the intentional corners at turns.
 */
export type GuidePrimitive =
  | {
    kind: "arc";
    /** Separate AR paths must never be joined across different feet. */
    subpathId?: string;
    centerM: Point;
    radiusM: number;
    startAngleRad: number;
    /** Signed angle. Positive is counter-clockwise; negative is clockwise. */
    sweepAngleRad: number;
  }
  | { kind: "line"; subpathId?: string; startM: Point; endM: Point };

export type GuideMarkerKind =
  | "change-edge" | "three-turn" | "bracket" | "choctaw" | "counter"
  | "rocker" | "mohawk" | "twizzle" | "toe-step" | "loop" | "step";

export type GuideMarker = {
  id: string;
  kind: GuideMarkerKind;
  label: string;
  positionM: Point;
  /** Present where the source diagram specifies a minimum rotation count. */
  minimumRotations?: number;
};
/** A renderable, non-connecting portion of a guide. */
export type GuideSubpath = {
  id: string;
  foot?: Foot;
  pointsM: Point[];
};

export type Foot = "left" | "right";
export type CameraMotionMode = "fixed" | "rink-lines";
export type TravelDirection = "F" | "B" | "?";
export type EdgeCode = "LFO" | "LFI" | "LBO" | "LBI" | "RFO" | "RFI" | "RBO" | "RBI";
export type EdgeReviewStatus = "unreviewed" | "confirmed" | "corrected";
export type HockeyRinkLineId = "goal-left" | "blue-left" | "center" | "blue-right" | "goal-right";
export type HockeyLineColor = "red" | "blue";
export type RinkProfileId = "iihf-60x30" | "iihf-60x26";

export type RinkProfile = {
  id: RinkProfileId;
  label: string;
  lengthM: number;
  widthM: number;
};

export type FootSample = {
  foot: Foot;
  timestampMs: number;
  toe: Point;
  heel: Point;
  ankle: Point;
  visibility: number;
};

export type MetricSample = FootSample & {
  positionM: Point;
  direction: TravelDirection;
};

export type Calibration = {
  /**
   * Normalized image coordinates of four virtual rink references. These may
   * lie outside the video frame when the rink boundary is not fully visible.
   */
  imageCorners: Point[];
  /** The same four references in the selected rink's metre coordinate system. */
  rinkCornersM: Point[];
  rinkProfile: RinkProfileId;
  /**
   * Four visible, high-contrast image features used only for moving-camera
   * tracking. They deliberately differ from imageCorners.
   */
  trackingImagePoints?: Point[];
};

/** Per-frame rink-line positions used to cancel handheld camera movement. */
export type FrameCalibration = {
  timestampMs: number;
  imageCorners: Point[];
  confidence: number;
};

export type RinkLineReference = {
  videoLineId: string;
  rinkLineId: HockeyRinkLineId;
  color: HockeyLineColor;
  start: Point;
  end: Point;
  score: number;
};

export type PatternJson = {
  schemaVersion: 2;
  source: { videoName: string; durationMs: number };
  coordinateSystem: "rink-floor-local-metres";
  calibration: Calibration;
  tracks: Record<Foot, MetricSample[]>;
  notes: string[];
  rinkLineReferences?: RinkLineReference[];
  cameraStabilization?: {
    mode: CameraMotionMode;
    referenceTimestampMs: number;
    stabilizedFrames: number;
    totalFrames: number;
  };
};

export type TaskTemplateSegment = {
  id: string;
  foot: Foot;
  /** Identifies the non-connecting AR subpath for this skating foot. */
  subpathId: string;
  startFraction: number;
  endFraction: number;
  expectedEdge: EdgeCode;
  /** Direct samples for this edge only; they cannot bridge to another foot. */
  guidePointsM: Point[];
};

export type TaskTemplate = {
  id: string;
  title: string;
  source: { document: string; pdfPage: number; printedPage: string };
  /** Source-of-truth geometry for AR clients. Never interpolate this as a spline. */
  guidePath: {
    schemaVersion: 1;
    coordinateUnit: "metres";
    interpolation: "explicit-arcs-and-lines";
    sampleSpacingM: number;
    /** Physical gap inserted at every foot change instead of a connecting line. */
    footChangeGapM: number;
    primitives: GuidePrimitive[];
    markers: GuideMarker[];
  };
  /** Render each array separately. Do not join or spline between subpaths. */
  guideSubpathsM: GuideSubpath[];
  segments: TaskTemplateSegment[];
};

export type EdgeReview = {
  taskId: string;
  segmentId: string;
  expectedEdge: EdgeCode;
  reviewedEdge?: EdgeCode;
  status: EdgeReviewStatus;
  note: string;
};

export type TrainingDataset = {
  schemaVersion: 1;
  createdAt: string;
  sourceVideoName?: string;
  task: Pick<TaskTemplate, "id" | "title" | "source">;
  reviews: EdgeReview[];
  observedTracks?: Record<Foot, MetricSample[]>;
};
