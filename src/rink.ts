import type { Calibration, HockeyLineColor, HockeyRinkLineId, Point, RinkLineReference, RinkProfile, RinkProfileId } from "./model";

export const RINK_PROFILES: RinkProfile[] = [
  { id: "iihf-60x30", label: "IIHF 60 × 30 m", lengthM: 60, widthM: 30 },
  { id: "iihf-60x26", label: "IIHF 60 × 26 m", lengthM: 60, widthM: 26 }
];

export const RINK_LINES: Array<{ id: HockeyRinkLineId; label: string; color: HockeyLineColor; xM: number }> = [
  { id: "goal-left", label: "左ゴールライン", color: "red", xM: 4 },
  { id: "blue-left", label: "左ブルーライン", color: "blue", xM: 22.86 },
  { id: "center", label: "センターライン", color: "red", xM: 30 },
  { id: "blue-right", label: "右ブルーライン", color: "blue", xM: 37.14 },
  { id: "goal-right", label: "右ゴールライン", color: "red", xM: 56 }
];

export function rinkProfile(id: RinkProfileId): RinkProfile {
  return RINK_PROFILES.find((profile) => profile.id === id) ?? RINK_PROFILES[0];
}

export function rinkBoundaryCorners(profile: RinkProfile): Point[] {
  return [
    { x: 0, y: 0 },
    { x: profile.lengthM, y: 0 },
    { x: profile.lengthM, y: profile.widthM },
    { x: 0, y: profile.widthM }
  ];
}

export function rinkLineById(id: HockeyRinkLineId) {
  return RINK_LINES.find((line) => line.id === id);
}

/**
 * Creates four image-to-rink correspondences from two full-width rink lines.
 * The upper endpoint of each video line is paired with y=0, and the lower
 * endpoint with y=rink width. This is valid only when each endpoint is at a
 * board intersection; the UI keeps manual four-corner calibration available
 * for other shots.
 */
export function calibrationFromNamedLines(references: RinkLineReference[], profileId: RinkProfileId): Calibration | undefined {
  if (references.length !== 2 || references[0].rinkLineId === references[1].rinkLineId) return undefined;
  const profile = rinkProfile(profileId);
  const pairs = references.flatMap((reference) => {
    const line = rinkLineById(reference.rinkLineId);
    if (!line) return [];
    const [upper, lower] = orderLineEndsTopToBottom(reference);
    return [
      { image: upper, rink: { x: line.xM, y: 0 } },
      { image: lower, rink: { x: line.xM, y: profile.widthM } }
    ];
  });
  if (pairs.length !== 4) return undefined;
  return {
    imageCorners: pairs.map((pair) => pair.image),
    rinkCornersM: pairs.map((pair) => pair.rink),
    rinkProfile: profile.id
  };
}

function orderLineEndsTopToBottom(reference: RinkLineReference): [Point, Point] {
  return reference.start.y <= reference.end.y ? [reference.start, reference.end] : [reference.end, reference.start];
}
