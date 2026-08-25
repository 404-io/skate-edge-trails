export type Point = { x: number; y: number };

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
  /** Normalized image coordinates of the four references tracked in every frame. */
  imageCorners: Point[];
  /** The same four references in the selected rink's metre coordinate system. */
  rinkCornersM: Point[];
  rinkProfile: RinkProfileId;
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
  startFraction: number;
  endFraction: number;
  expectedEdge: EdgeCode;
};

export type TaskTemplate = {
  id: string;
  title: string;
  source: { document: string; pdfPage: number; printedPage: string };
  guidePointsM: Point[];
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
