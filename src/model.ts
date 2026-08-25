export type Point = { x: number; y: number };

export type Foot = "left" | "right";
export type TravelDirection = "F" | "B" | "?";

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

