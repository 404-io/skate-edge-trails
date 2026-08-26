import { useEffect, useMemo, useState } from "react";
import type { EdgeCode, EdgeReview, EdgeReviewStatus, Foot, MetricSample, TaskTemplate, TrainingDataset } from "./model";
import { EDGE_CODES, TASK_TEMPLATES } from "./taskTemplates";

type ReviewDraft = { reviewedEdge: EdgeCode | ""; status: EdgeReviewStatus; note: string };

function defaultDrafts(template: TaskTemplate): Record<string, ReviewDraft> {
  return Object.fromEntries(template.segments.map((segment) => [segment.id, { reviewedEdge: "", status: "unreviewed", note: "" }]));
}

function downloadJson(fileName: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function TaskDatasetPanel({ tracks, videoName }: { tracks?: Record<Foot, MetricSample[]>; videoName?: string }) {
  const [templateId, setTemplateId] = useState(TASK_TEMPLATES[0].id);
  const template = useMemo(() => TASK_TEMPLATES.find((item) => item.id === templateId) ?? TASK_TEMPLATES[0], [templateId]);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>(() => defaultDrafts(template));

  useEffect(() => setDrafts(defaultDrafts(template)), [template]);

  const reviewedCount = Object.values(drafts).filter((draft) => draft.status !== "unreviewed" && draft.reviewedEdge).length;

  function updateDraft(segmentId: string, patch: Partial<ReviewDraft>) {
    setDrafts((current) => ({ ...current, [segmentId]: { ...current[segmentId], ...patch } }));
  }

  function confirmExpected(segmentId: string, expectedEdge: EdgeCode) {
    updateDraft(segmentId, { reviewedEdge: expectedEdge, status: "confirmed" });
  }

  function exportGuide() {
    downloadJson(`${template.id}-ar-guide.json`, {
      schemaVersion: 1,
      coordinateSystem: "rink-floor-local-metres",
      template
    });
  }

  function exportDataset() {
    const reviews: EdgeReview[] = template.segments.map((segment) => ({
      taskId: template.id,
      segmentId: segment.id,
      expectedEdge: segment.expectedEdge,
      reviewedEdge: drafts[segment.id].reviewedEdge || undefined,
      status: drafts[segment.id].status,
      note: drafts[segment.id].note
    }));
    const dataset: TrainingDataset = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourceVideoName: videoName,
      task: { id: template.id, title: template.title, source: template.source },
      reviews,
      observedTracks: tracks
    };
    downloadJson(`${template.id}-reviewed-edges.json`, dataset);
  }

  return (
    <section className="panel task-panel">
      <div className="task-header">
        <div>
          <p className="eyebrow">TASK PRACTICE → REVIEWED DATASET</p>
          <h2>課題練習・エッジ確認</h2>
          <p>ARには足ごとに分離した課題ガイドJSONを渡します。足替え位置は隙間を持つ別パスとして出力されます。</p>
        </div>
        <button type="button" className="secondary" onClick={exportGuide}>ARガイドJSON</button>
      </div>

      <div className="task-grid">
        <div>
          <label className="task-select">課題テンプレート
            <select value={template.id} onChange={(event) => setTemplateId(event.target.value)}>
              {TASK_TEMPLATES.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <TemplateChart template={template} reviews={drafts} />
          <p className="task-note">出典: {template.source.document} PDF {template.source.pdfPage}ページ（冊子 {template.source.printedPage}ページ）。軌跡はAR配置用のメートル基準ガイドです。</p>
        </div>

        <div>
          <h3>レビューして学習データにする</h3>
          <p className="task-note">「課題通り」は動画またはコーチ確認後に押します。予想ラベルを自動で正解にしないことが、I/O判定の精度を守ります。</p>
          <div className="review-list">
            {template.segments.map((segment, index) => {
              const draft = drafts[segment.id];
              return (
                <div className="review-row" key={segment.id}>
                  <label>区間 {index + 1}<strong>{segment.expectedEdge}</strong></label>
                  <select value={draft.reviewedEdge} onChange={(event) => {
                    const reviewedEdge = event.target.value as EdgeCode | "";
                    updateDraft(segment.id, { reviewedEdge, status: reviewedEdge ? (reviewedEdge === segment.expectedEdge ? "confirmed" : "corrected") : "unreviewed" });
                  }} aria-label={`区間${index + 1}の確認エッジ`}>
                    <option value="">未確認</option>
                    {EDGE_CODES.map((edge) => <option value={edge} key={edge}>{edge}</option>)}
                  </select>
                  <input value={draft.note} onChange={(event) => updateDraft(segment.id, { note: event.target.value })} placeholder="メモ（任意）" aria-label={`区間${index + 1}のメモ`} />
                  <button type="button" className="secondary" onClick={() => confirmExpected(segment.id, segment.expectedEdge)}>課題通り</button>
                </div>
              );
            })}
          </div>
          <p className="training-state">{tracks ? "解析済み動画の軌跡をデータセットへ添付します。" : "先に動画を解析すると、確認済みラベルと実走軌跡を一つのデータセットに保存できます。"}<br />確認済み: {reviewedCount} / {template.segments.length} 区間</p>
          <button type="button" onClick={exportDataset} disabled={!tracks || reviewedCount === 0}>確認済みデータセットを書き出す</button>
        </div>
      </div>
    </section>
  );
}

function TemplateChart({ template, reviews }: { template: TaskTemplate; reviews: Record<string, ReviewDraft> }) {
  const subpaths = template.guideSubpathsM;
  const points = subpaths.flatMap((path) => path.pointsM);
  if (!points.length) return null;
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const width = maxX - minX + 1.4;
  const height = maxY - minY + 1.2;
  const pointText = (point: { x: number; y: number }) => `${point.x - minX + .7},${maxY - point.y + .55}`;
  const start = subpaths[0].pointsM[0];

  return (
    <svg className="task-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${template.title}のAR課題ガイド`}>
      <g opacity=".16" stroke="#355461" strokeWidth=".025">
        {Array.from({ length: Math.ceil(width) + 1 }, (_, index) => <line key={`x-${index}`} x1={index} y1="0" x2={index} y2={height} />)}
        {Array.from({ length: Math.ceil(height) + 1 }, (_, index) => <line key={`y-${index}`} x1="0" y1={index} x2={width} y2={index} />)}
      </g>
      {subpaths.map((path) => <polyline key={path.id} points={path.pointsM.map(pointText).join(" ")} fill="none" stroke="#c6d5d8" strokeWidth=".12" strokeLinecap="round" />)}
      {template.segments.map((segment, index) => {
        const edgePoints = segment.guidePointsM;
        if (!edgePoints.length) return null;
        const reviewed = reviews[segment.id]?.status !== "unreviewed";
        const middle = edgePoints[Math.floor(edgePoints.length / 2)];
        return <g key={segment.id}>
          <polyline points={edgePoints.map(pointText).join(" ")} fill="none" stroke={reviewed ? "#2d766f" : "#406fba"} strokeWidth=".13" strokeLinecap="round" />
          <text x={Number(pointText(middle).split(",")[0]) + .18} y={Number(pointText(middle).split(",")[1]) - .12} fontSize=".34" fontWeight="700" fill="#10212b">{index + 1}. {segment.expectedEdge}</text>
        </g>;
      })}
      {template.guidePath.markers.map((item) => <g key={item.id}>
        <circle cx={pointText(item.positionM).split(",")[0]} cy={pointText(item.positionM).split(",")[1]} r=".11" fill={item.kind === "step" ? "#ff9b71" : "#f2c878"} />
        <text x={Number(pointText(item.positionM).split(",")[0]) + .16} y={Number(pointText(item.positionM).split(",")[1]) + .1} fontSize=".23" fill="#10212b">{item.label}</text>
      </g>)}
      <circle cx={pointText(start).split(",")[0]} cy={pointText(start).split(",")[1]} r=".16" fill="#ff9b71" />
      <text x={Number(pointText(start).split(",")[0]) + .22} y={Number(pointText(start).split(",")[1]) + .12} fontSize=".28" fill="#10212b">開始</text>
    </svg>
  );
}