import { type ChangeEvent, type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";
import { makeMetricSamples, simplify } from "./geometry";
import { detectHockeyLines, type DetectedVideoLine } from "./hockeyLines";
import type { Calibration, CameraMotionMode, Foot, FootSample, FrameCalibration, HockeyLineColor, HockeyRinkLineId, MetricSample, PatternJson, Point, RinkLineReference } from "./model";
import { analyseVideo } from "./pose";
import { TaskDatasetPanel } from "./TaskDatasetPanel";

const CORNER_NAMES = ["左奥", "右奥", "右手前", "左手前"];
const RINK_LINES: Array<{ id: HockeyRinkLineId; label: string; color: HockeyLineColor; x: number }> = [
  { id: "goal-left", label: "左ゴールライン", color: "red", x: 18 },
  { id: "blue-left", label: "左ブルーライン", color: "blue", x: 37 },
  { id: "center", label: "センターライン", color: "red", x: 50 },
  { id: "blue-right", label: "右ブルーライン", color: "blue", x: 63 },
  { id: "goal-right", label: "右ゴールライン", color: "red", x: 82 }
];

type AnalysisStats = { totalFrames: number; stabilizedFrames: number };
type VideoSize = { width: number; height: number };

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File>();
  const [videoUrl, setVideoUrl] = useState<string>();
  const [videoSize, setVideoSize] = useState<VideoSize>();
  const [corners, setCorners] = useState<Point[]>([]);
  const [widthM, setWidthM] = useState(6);
  const [lengthM, setLengthM] = useState(8);
  const [cameraMode, setCameraMode] = useState<CameraMotionMode>("fixed");
  const [referenceTimestampMs, setReferenceTimestampMs] = useState(0);
  const [samples, setSamples] = useState<FootSample[]>([]);
  const [frameCalibrations, setFrameCalibrations] = useState<FrameCalibration[]>([]);
  const [analysisStats, setAnalysisStats] = useState<AnalysisStats>();
  const [detectedLines, setDetectedLines] = useState<DetectedVideoLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [activeLineId, setActiveLineId] = useState<string>();
  const [rinkLineReferences, setRinkLineReferences] = useState<RinkLineReference[]>([]);
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("動画を選び、ホッケーラインの交点を4点指定してください。");

  const calibration: Calibration | undefined = corners.length === 4 ? { imageCorners: corners, widthM, lengthM } : undefined;
  const tracks = useMemo<Record<Foot, MetricSample[]> | undefined>(() => {
    if (!calibration || samples.length === 0) return undefined;
    try {
      const perFrameCalibration = cameraMode === "rink-lines" ? frameCalibrations : undefined;
      return {
        left: simplify(makeMetricSamples(samples.filter((sample) => sample.foot === "left"), calibration, perFrameCalibration)),
        right: simplify(makeMetricSamples(samples.filter((sample) => sample.foot === "right"), calibration, perFrameCalibration))
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "校正に失敗しました。");
      return undefined;
    }
  }, [calibration, cameraMode, frameCalibrations, samples]);
  const hasTracks = Boolean(tracks && (tracks.left.length > 0 || tracks.right.length > 0));
  const activeLine = detectedLines.find((line) => line.id === activeLineId);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(selected);
    setVideoUrl(URL.createObjectURL(selected));
    setVideoSize(undefined);
    resetCalibrationState();
    setDetectedLines([]);
    setSelectedLineIds([]);
    setActiveLineId(undefined);
    setRinkLineReferences([]);
    setMessage("動画上で、既知サイズのホッケーライン長方形を左奥→右奥→右手前→左手前の順にタップしてください。ライン検出の利用もできます。");
  }

  function onLoadedMetadata() {
    const video = videoRef.current;
    if (!video) return;
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
  }

  function addCorner(event: ReactMouseEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !videoSize || corners.length === 4) return;
    const point = pointFromVideoStage(event, video);
    if (!point) {
      setMessage("黒い余白ではなく、映像部分にあるホッケーラインの交点をタップしてください。");
      return;
    }
    if (corners.length === 3) setReferenceFrame(video);
    setCorners((current) => [...current, point]);
    clearAnalysis();
  }

  function resetCalibrationState() {
    setCorners([]);
    setReferenceTimestampMs(0);
    clearAnalysis();
  }

  function clearAnalysis() {
    setSamples([]);
    setFrameCalibrations([]);
    setAnalysisStats(undefined);
  }

  function setReferenceFrame(video: HTMLVideoElement) {
    const timestamp = Math.round(video.currentTime * 1000);
    setReferenceTimestampMs(timestamp);
    setMessage(cameraMode === "rink-lines"
      ? `基準フレームを ${formatTime(timestamp)} に設定しました。ここから先をリンクライン基準で補正します。`
      : "校正点を設定しました。軌跡を作れます。");
  }

  function resetCalibration() {
    resetCalibrationState();
    setMessage("ホッケーライン長方形の4つの交点を、左奥から順に指定してください。ライン検出を使う場合は、候補を2本選びます。");
  }

  function changeCameraMode(mode: CameraMotionMode) {
    setCameraMode(mode);
    clearAnalysis();
    setMessage(mode === "rink-lines"
      ? "移動カメラ補正を選びました。開始フレームで、見えているリンクラインを検出・選択するか、4点を指定してください。"
      : "固定カメラ補正を選びました。ホッケーライン長方形を4点指定してください。");
  }

  function detectLines() {
    const video = videoRef.current;
    if (!video || !videoSize) return;
    try {
      const candidates = detectHockeyLines(video);
      setDetectedLines(candidates);
      setSelectedLineIds([]);
      setActiveLineId(candidates[0]?.id);
      setRinkLineReferences([]);
      setMessage(`${candidates.length} 本の赤線・青線候補を検出しました。候補を選び、下のリンク図で名称を割り当ててください。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ライン検出に失敗しました。");
    }
  }

  function toggleCalibrationLine(id: string) {
    setSelectedLineIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 2) {
        setMessage("校正に使えるのは2本までです。不要な候補を外してください。");
        return current;
      }
      return [...current, id];
    });
  }

  function assignRinkLine(rinkLineId: HockeyRinkLineId) {
    if (!activeLine) {
      setMessage("先に動画のライン候補を選択してください。");
      return;
    }
    const target = RINK_LINES.find((line) => line.id === rinkLineId)!;
    if (target.color !== activeLine.color) {
      setMessage(`${target.label}は${target.color === "red" ? "赤線" : "青線"}です。動画の候補色と一致する線を選んでください。`);
      return;
    }
    setRinkLineReferences((current) => [
      ...current.filter((reference) => reference.rinkLineId !== rinkLineId && !sameVideoLine(reference, activeLine.id)),
      { rinkLineId, color: activeLine.color, start: activeLine.start, end: activeLine.end, score: activeLine.score }
    ]);
    setMessage(`動画候補を「${target.label}」として登録しました。校正に使う候補を2本選んでください。`);
  }

  function useDetectedLinesForCalibration() {
    const video = videoRef.current;
    const lines = selectedLineIds.map((id) => detectedLines.find((line) => line.id === id)).filter(Boolean) as DetectedVideoLine[];
    if (!video || lines.length !== 2) {
      setMessage("校正には動画上のライン候補を2本選んでください。");
      return;
    }
    const nextCorners = cornersFromLines(lines);
    if (!nextCorners) {
      setMessage("選んだ候補から四隅を作れませんでした。長くはっきり映る、ほぼ平行な2本のラインを選んでください。");
      return;
    }
    setCorners(nextCorners);
    setReferenceFrame(video);
    clearAnalysis();
    setMessage("選んだ2本のラインから4つの校正点を配置しました。必要なら「校正点をやり直す」で手動指定できます。");
  }

  async function runAnalysis() {
    const video = videoRef.current;
    if (!video || !calibration || !file) return;
    if (!Number.isFinite(video.duration)) {
      setMessage("動画の読み込み完了を待ってください。");
      return;
    }
    setProgress(0);
    setMessage(cameraMode === "rink-lines"
      ? "足先とホッケーラインを追跡し、カメラ移動を補正しています。"
      : "足先を追跡しています。長い動画では少し時間がかかります。");
    try {
      const result = await analyseVideo(video, { calibration, cameraMode, referenceTimestampMs, onProgress: setProgress });
      if (cameraMode === "rink-lines" && result.stabilizedFrames === 0) {
        throw new Error("ラインを追跡できませんでした。交点またはライン端がはっきり見える開始フレームで校正してください。");
      }
      setSamples(result.samples);
      setFrameCalibrations(result.frameCalibrations);
      setAnalysisStats({ totalFrames: result.totalFrames, stabilizedFrames: result.stabilizedFrames });
      const trackingMessage = cameraMode === "rink-lines"
        ? `ライン補正 ${result.stabilizedFrames}/${result.totalFrames} フレーム。追跡不能なフレームは軌跡から除外しました。`
        : "軌跡を生成しました。";
      setMessage(`${trackingMessage} I/Oエッジは、単眼動画だけでは確度不足のため未確定として扱います。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解析に失敗しました。");
    } finally {
      setProgress(undefined);
    }
  }

  function exportJson() {
    if (!tracks || !hasTracks || !calibration || !file || !videoRef.current) return;
    const pattern: PatternJson = {
      schemaVersion: 1,
      source: { videoName: file.name, durationMs: Math.round(videoRef.current.duration * 1000) },
      coordinateSystem: "rink-floor-local-metres",
      calibration,
      tracks,
      notes: ["F/Bは足先・かかとと移動方向から推定。I/Oは単眼動画では未確定。", "移動カメラ時はホッケーライン交点をフレームごとに追跡して座標を補正。"],
      ...(rinkLineReferences.length > 0 ? { rinkLineReferences } : {}),
      ...(cameraMode === "rink-lines" && analysisStats ? {
        cameraStabilization: { mode: cameraMode, referenceTimestampMs, stabilizedFrames: analysisStats.stabilizedFrames, totalFrames: analysisStats.totalFrames }
      } : {})
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(pattern, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "skate-pattern.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const overlayWidth = videoSize?.width ?? 1;
  const overlayHeight = videoSize?.height ?? 1;
  const overlayScale = Math.max(overlayWidth, overlayHeight);

  return (
    <main>
      <header>
        <p className="eyebrow">VIDEO → RINK PATTERN → AR</p>
        <h1>Skate Edge Trails</h1>
        <p>動画から左右の足跡を取り出し、ホッケーラインを基準に実寸のパターン表へ変換します。</p>
      </header>

      <section className="workflow">
        <label className="file-input"><span>1. 動画を選択</span><input accept="video/*" type="file" onChange={chooseFile} /></label>
        <label>撮影方法<select value={cameraMode} onChange={(event) => changeCameraMode(event.target.value as CameraMotionMode)}><option value="fixed">固定カメラ</option><option value="rink-lines">移動カメラ（リンクライン補正）</option></select></label>
        <label>校正幅（m）<input type="number" min="0.5" step="0.1" value={widthM} onChange={(event) => setWidthM(Number(event.target.value))} /></label>
        <label>校正奥行（m）<input type="number" min="0.5" step="0.1" value={lengthM} onChange={(event) => setLengthM(Number(event.target.value))} /></label>
        <button type="button" className="secondary" onClick={resetCalibration} disabled={corners.length === 0}>校正点をやり直す</button>
        <button type="button" onClick={runAnalysis} disabled={!calibration || !file || progress !== undefined}>2. 補正して軌跡を作る</button>
      </section>

      <p className="notice">{message}{progress !== undefined && ` ${Math.round(progress * 100)}%`}</p>

      <section className="content-grid">
        <article className="panel">
          <h2>動画とリンク校正</h2>
          {videoUrl ? (
            <div className="video-stage" onClick={addCorner}>
              <video ref={videoRef} src={videoUrl} controls playsInline onLoadedMetadata={onLoadedMetadata} />
              <svg viewBox={`0 0 ${overlayWidth} ${overlayHeight}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                {detectedLines.map((line) => <g key={line.id} opacity={activeLineId === line.id ? 1 : .56}><line x1={line.start.x * overlayWidth} y1={line.start.y * overlayHeight} x2={line.end.x * overlayWidth} y2={line.end.y * overlayHeight} stroke={line.color === "red" ? "#ff6e63" : "#4d97ff"} strokeWidth={overlayScale * (selectedLineIds.includes(line.id) ? .007 : .004)} /><text x={line.start.x * overlayWidth} y={line.start.y * overlayHeight - overlayScale * .012} fill="white" fontSize={overlayScale * .024}>{candidateLabel(line, rinkLineReferences)}</text></g>)}
                {corners.length > 1 && <polyline points={corners.map((point) => `${point.x * overlayWidth},${point.y * overlayHeight}`).join(" ")} fill="none" stroke="#ffca62" strokeWidth={overlayScale * .0035} />}
                {corners.map((point, index) => <g key={`${point.x}-${point.y}`}><circle cx={point.x * overlayWidth} cy={point.y * overlayHeight} r={overlayScale * .011} fill="#ffca62" /><text x={point.x * overlayWidth + overlayScale * .012} y={point.y * overlayHeight - overlayScale * .012} fill="white" fontSize={overlayScale * .027}>{index + 1}</text></g>)}
              </svg>
            </div>
          ) : <div className="empty">MP4などの動画を選択すると、ここに表示されます。</div>}
          <ol className="corner-list">{CORNER_NAMES.map((name, index) => <li key={name} className={corners[index] ? "done" : ""}>{index + 1}. {name}</li>)}</ol>
          <LineCalibrationPanel
            disabled={!videoSize}
            candidates={detectedLines}
            selectedIds={selectedLineIds}
            activeId={activeLineId}
            activeLine={activeLine}
            references={rinkLineReferences}
            onDetect={detectLines}
            onActivate={setActiveLineId}
            onToggle={toggleCalibrationLine}
            onAssign={assignRinkLine}
            onUseForCalibration={useDetectedLinesForCalibration}
          />
          {cameraMode === "rink-lines" && <p className="tracking-help">移動カメラでは、基準フレーム（{formatTime(referenceTimestampMs)}）から先を解析します。4点とも、スケーターに隠れないライン交点またはライン端を選んでください。</p>}
        </article>

        <article className="panel">
          <div className="panel-title"><h2>足軌跡パターン</h2><button type="button" className="secondary" onClick={exportJson} disabled={!hasTracks}>JSONを書き出す</button></div>
          {hasTracks && tracks ? <PatternChart tracks={tracks} /> : <div className="empty">解析後、ここに左足・右足の軌跡が実寸で描画されます。</div>}
          <p className="legend"><span className="left-dot" /> 左足　<span className="right-dot" /> 右足　→ は推定した前進／後進方向です。イン／アウトは推測で確定しません。</p>
          {cameraMode === "rink-lines" && analysisStats && <p className="tracking-result">ライン補正率: {analysisStats.stabilizedFrames}/{analysisStats.totalFrames} フレーム</p>}
        </article>
      </section>
      <TaskDatasetPanel tracks={hasTracks ? tracks : undefined} videoName={file?.name} />
    </main>
  );
}

function LineCalibrationPanel({ disabled, candidates, selectedIds, activeId, activeLine, references, onDetect, onActivate, onToggle, onAssign, onUseForCalibration }: {
  disabled: boolean; candidates: DetectedVideoLine[]; selectedIds: string[]; activeId?: string; activeLine?: DetectedVideoLine; references: RinkLineReference[];
  onDetect: () => void; onActivate: (id: string) => void; onToggle: (id: string) => void; onAssign: (id: HockeyRinkLineId) => void; onUseForCalibration: () => void;
}) {
  return <section className="line-assist">
    <div className="panel-title"><h3>ライン検出・リンク図割り当て</h3><button type="button" className="secondary" onClick={onDetect} disabled={disabled}>動画のラインを検出</button></div>
    <p>候補を選択し、図の同じ色の線をタップして名称を割り当てます。校正には候補を2本選びます。</p>
    {candidates.length > 0 && <div className="line-assist-grid">
      <div className="candidate-list">{candidates.map((line) => <div key={line.id} className={`candidate-row ${activeId === line.id ? "active" : ""}`}><button type="button" onClick={() => onActivate(line.id)}><span className={`line-swatch ${line.color}`} />{candidateLabel(line, references)}</button><label><input type="checkbox" checked={selectedIds.includes(line.id)} onChange={() => onToggle(line.id)} />校正</label></div>)}</div>
      <RinkDiagram activeLine={activeLine} onAssign={onAssign} />
    </div>}
    {candidates.length > 0 && <button type="button" onClick={onUseForCalibration} disabled={selectedIds.length !== 2}>選んだ2本のラインから校正点を配置</button>}
  </section>;
}

function RinkDiagram({ activeLine, onAssign }: { activeLine?: DetectedVideoLine; onAssign: (id: HockeyRinkLineId) => void }) {
  return <div className="rink-diagram"><p>{activeLine ? `選択中: ${activeLine.color === "red" ? "赤線" : "青線"}候補` : "動画候補を選択してください"}</p><svg viewBox="0 0 100 52" role="img" aria-label="ホッケーリンクのライン図">
    <rect x="4" y="5" width="92" height="42" rx="12" fill="#f8fbfb" stroke="#244552" strokeWidth="1.2" />
    <circle cx="50" cy="26" r="9" fill="none" stroke="#e05d5d" strokeWidth="1" opacity=".7" />
    {RINK_LINES.map((line) => <g key={line.id} className={activeLine?.color === line.color ? "rink-line available" : "rink-line"} role="button" tabIndex={0} onClick={() => activeLine && onAssign(line.id)} onKeyDown={(event) => { if (activeLine && (event.key === "Enter" || event.key === " ")) onAssign(line.id); }}><line x1={line.x} y1="6" x2={line.x} y2="46" stroke={line.color === "red" ? "#e05d5d" : "#3674c7"} strokeWidth={line.id === "center" ? "1.6" : "2.4"} /><text x={line.x} y="51" textAnchor="middle" fontSize="3.2">{line.id === "center" ? "C" : line.id.includes("blue") ? "B" : "G"}</text></g>)}
  </svg></div>;
}

function pointFromVideoStage(event: ReactMouseEvent<HTMLDivElement>, video: HTMLVideoElement): Point | undefined {
  if (!video.videoWidth || !video.videoHeight) return undefined;
  const bounds = event.currentTarget.getBoundingClientRect();
  const sourceRatio = video.videoWidth / video.videoHeight;
  const stageRatio = bounds.width / bounds.height;
  const renderedWidth = sourceRatio > stageRatio ? bounds.width : bounds.height * sourceRatio;
  const renderedHeight = sourceRatio > stageRatio ? bounds.width / sourceRatio : bounds.height;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const x = (event.clientX - bounds.left - offsetX) / renderedWidth;
  const y = (event.clientY - bounds.top - offsetY) / renderedHeight;
  if (x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  return { x, y };
}

function cornersFromLines(lines: DetectedVideoLine[]): Point[] | undefined {
  const [far, near] = [...lines].sort((left, right) => midpoint(left).y - midpoint(right).y);
  const farEnds = orderLineEnds(far);
  const nearEnds = orderLineEnds(near);
  if (Math.abs(midpoint(far).y - midpoint(near).y) < .04) return undefined;
  return [farEnds[0], farEnds[1], nearEnds[1], nearEnds[0]];
}

function midpoint(line: DetectedVideoLine): Point { return { x: (line.start.x + line.end.x) / 2, y: (line.start.y + line.end.y) / 2 }; }
function orderLineEnds(line: DetectedVideoLine): [Point, Point] {
  const startFirst = Math.abs(line.end.x - line.start.x) >= Math.abs(line.end.y - line.start.y) ? line.start.x <= line.end.x : line.start.y <= line.end.y;
  return startFirst ? [line.start, line.end] : [line.end, line.start];
}
function sameVideoLine(reference: RinkLineReference, candidateId: string): boolean { return candidateId === `${reference.color}-${reference.score}`; }
function candidateLabel(line: DetectedVideoLine, references: RinkLineReference[]): string {
  const reference = references.find((item) => item.color === line.color && item.score === line.score);
  const lineName = reference ? RINK_LINES.find((item) => item.id === reference.rinkLineId)?.label : undefined;
  return `${line.color === "red" ? "赤" : "青"}候補 ${line.id.split("-").at(-1)}${lineName ? ` → ${lineName}` : ""}`;
}
function formatTime(timestampMs: number): string { const seconds = Math.max(0, Math.round(timestampMs / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function PatternChart({ tracks }: { tracks: Record<Foot, MetricSample[]> }) {
  const all = [...tracks.left, ...tracks.right]; const minX = Math.min(...all.map((sample) => sample.positionM.x)); const maxX = Math.max(...all.map((sample) => sample.positionM.x)); const minY = Math.min(...all.map((sample) => sample.positionM.y)); const maxY = Math.max(...all.map((sample) => sample.positionM.y)); const padding = .35; const width = Math.max(1, maxX - minX + padding * 2); const height = Math.max(1, maxY - minY + padding * 2); const project = (sample: MetricSample) => `${sample.positionM.x - minX + padding},${sample.positionM.y - minY + padding}`; const endpoint = (items: MetricSample[]) => items.at(-1);
  return <svg className="pattern-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="左右の足軌跡パターン"><rect x="0" y="0" width={width} height={height} fill="#f8fbfb" /><g opacity=".16" stroke="#355461" strokeWidth=".015">{Array.from({ length: Math.ceil(width) + 1 }, (_, index) => <line key={`x-${index}`} x1={index} y1="0" x2={index} y2={height} />)}{Array.from({ length: Math.ceil(height) + 1 }, (_, index) => <line key={`y-${index}`} x1="0" y1={index} x2={width} y2={index} />)}</g><Track samples={tracks.left} color="#e05d5d" project={project} label="左足スタート" /><Track samples={tracks.right} color="#3674c7" project={project} label="右足スタート" />{[endpoint(tracks.left), endpoint(tracks.right)].filter(Boolean).map((sample) => sample && <circle key={`${sample.foot}-end`} cx={sample.positionM.x - minX + padding} cy={sample.positionM.y - minY + padding} r=".1" fill="none" stroke="#10212b" strokeWidth=".035" />)}</svg>;
}

function Track({ samples, color, project, label }: { samples: MetricSample[]; color: string; project: (sample: MetricSample) => string; label: string }) {
  if (samples.length === 0) return null; const start = samples[0];
  return <g><polyline points={samples.map(project).join(" ")} fill="none" stroke={color} strokeWidth=".09" strokeLinecap="round" strokeLinejoin="round" /><circle cx={project(start).split(",")[0]} cy={project(start).split(",")[1]} r=".12" fill={color} /><text x={Number(project(start).split(",")[0]) + .14} y={Number(project(start).split(",")[1]) - .13} fontSize=".23" fill="#10212b">{label}</text>{samples.filter((_, index) => index > 0 && index % 16 === 0).map((sample) => <text key={sample.timestampMs} x={Number(project(sample).split(",")[0]) + .06} y={Number(project(sample).split(",")[1]) - .06} fontSize=".2" fill={color}>{sample.direction}</text>)}</g>;
}

export default App;
