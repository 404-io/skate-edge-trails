export type Point = { x: number; y: number };

export type Foot = "left" | "right";
export type TravelDirection = "F" | "B" | "?";
export type EdgeCode = "LFO" | "LFI" | "LBO" | "LBI" | "RFO" | "RFI" | "RBO" | "RBI";
export type EdgeReviewStatus = "unreviewed" | "confirmed" | "corrected";

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
  /** Video coordinates in clockwise order: top-left, top-right, bottom-right, bottom-left. */
  imageCorners: Point[];
  widthM: number;
  lengthM: number;
};

export type PatternJson = {
  schemaVersion: 1;
  source: { videoName: string; durationMs: number };
  coordinateSystem: "rink-floor-local-metres";
  calibration: Calibration;
  tracks: Record<Foot, MetricSample[]>;
  notes: string[];
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
