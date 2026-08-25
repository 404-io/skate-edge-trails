import type { EdgeCode, Foot, Point, TaskTemplate } from "./model";

const source = {
  document: "2024バッジテスト規定集 本文 A4 Ver.1126C.pdf",
  pdfPage: 41,
  printedPage: "39"
};

function halfCircleGuide(edges: Array<{ edge: EdgeCode; foot: Foot }>, radiusM = 1.45): Point[] {
  const samplesPerHalf = 28;
  return edges.flatMap((_, index) =>
    Array.from({ length: samplesPerHalf + 1 }, (_, sampleIndex) => {
      const t = sampleIndex / samplesPerHalf;
      const side = index % 2 === 0 ? 1 : -1;
      return {
        x: side * radiusM * Math.sin(Math.PI * t),
        y: (index + t) * radiusM * 1.45
      };
    })
  );
}

function halfCircleTemplate(id: string, title: string, edges: Array<{ edge: EdgeCode; foot: Foot }>): TaskTemplate {
  return {
    id,
    title,
    source,
    guidePointsM: halfCircleGuide(edges),
    segments: edges.map((item, index) => ({
      id: `${id}-segment-${index + 1}`,
      foot: item.foot,
      startFraction: index / edges.length,
      endFraction: (index + 1) / edges.length,
      expectedEdge: item.edge
    }))
  };
}

export const TASK_TEMPLATES: TaskTemplate[] = [
  halfCircleTemplate(
    "badge-1-forward-change-half-circle-right",
    "1級 フォア・チェンジ・ハーフ・サークル（右足スタート）",
    [
      { edge: "RFO", foot: "right" },
      { edge: "RFI", foot: "right" },
      { edge: "LFI", foot: "left" },
      { edge: "LFO", foot: "left" }
    ]
  ),
  halfCircleTemplate(
    "badge-1-forward-change-half-circle-left",
    "1級 フォア・チェンジ・ハーフ・サークル（左足スタート）",
    [
      { edge: "LFO", foot: "left" },
      { edge: "LFI", foot: "left" },
      { edge: "RFI", foot: "right" },
      { edge: "RFO", foot: "right" }
    ]
  )
];

export const EDGE_CODES: EdgeCode[] = ["LFO", "LFI", "LBO", "LBI", "RFO", "RFI", "RBO", "RBI"];
