import { type ChangeEvent, type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";
import { invertHomography, makeHomography, makeMetricSamples, project, simplify } from "./geometry";
import { detectHockeyLines, type DetectedVideoLine } from "./hockeyLines";
import { calibrationFromNamedLines, RINK_LINES, RINK_PROFILES, rinkBoundaryCorners, rinkProfile } from "./rink";
import type { Calibration, CameraMotionMode, Foot, FootSample, FrameCalibration, HockeyRinkLineId, MetricSample, PatternJson, Point, RinkLineReference, RinkProfile, RinkProfileId } from "./model";
import { analyseVideo } from "./pose";
import { TaskDatasetPanel } from "./TaskDatasetPanel";

const CORNER_NAMES = ["左奥", "右奥", "右手前", "左手前"];
type VideoSize = { width: number; height: number };
type AnalysisStats = { totalFrames: number; stabilizedFrames: number };

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File>();
  const [videoUrl, setVideoUrl] = useState<string>();
  const [videoSize, setVideoSize] = useState<VideoSize>();
  const [imageCorners, setImageCorners] = useState<Point[]>([]);
  const [rinkCornersM, setRinkCornersM] = useState<Point[]>([]);
  const [rinkProfileId, setRinkProfileId] = useState<RinkProfileId>("iihf-60x30");
  const [cameraMode, setCameraMode] = useState<CameraMotionMode>("fixed");
  const [referenceTimestampMs, setReferenceTimestampMs] = useState(0);
  const [playbackTimestampMs, setPlaybackTimestampMs] = useState(0);
  const [samples, setSamples] = useState<FootSample[]>([]);
  const [frameCalibrations, setFrameCalibrations] = useState<FrameCalibration[]>([]);
  const [analysisStats, setAnalysisStats] = useState<AnalysisStats>();
  const [detectedLines, setDetectedLines] = useState<DetectedVideoLine[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [activeLineId, setActiveLineId] = useState<string>();
  const [rinkLineReferences, setRinkLineReferences] = useState<RinkLineReference[]>([]);
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("動画を選び、リンク外周の4点を指定するか、ホッケーラインを2本割り当ててください。");

  const profile = rinkProfile(rinkProfileId);
  const calibration = useMemo<Calibration | undefined>(() => imageCorners.length === 4 ? {
    imageCorners,
    rinkCornersM: rinkCornersM.length === 4 ? rinkCornersM : rinkBoundaryCorners(profile),
    rinkProfile: profile.id
  } : undefined, [imageCorners, profile, rinkCornersM]);
  const displayedCalibration = useMemo<Calibration | undefined>(() => {
    if (!calibration || cameraMode !== "rink-lines" || frameCalibrations.length === 0) return calibration;
    const closest = frameCalibrations.reduce((best, item) => Math.abs(item.timestampMs - playbackTimestampMs) < Math.abs(best.timestampMs - playbackTimestampMs) ? item : best);
    return Math.abs(closest.timestampMs - playbackTimestampMs) <= 750 ? { ...calibration, imageCorners: closest.imageCorners } : calibration;
  }, [calibration, cameraMode, frameCalibrations, playbackTimestampMs]);
  const tracks = useMemo<Record<Foot, MetricSample[]> | undefined>(() => {
    if (!calibration || samples.length === 0) return undefined;
    try {
      const perFrame = cameraMode === "rink-lines" ? frameCalibrations : undefined;
      return {
        left: simplify(makeMetricSamples(samples.filter((item) => item.foot === "left"), calibration, perFrame)),
        right: simplify(makeMetricSamples(samples.filter((item) => item.foot === "right"), calibration, perFrame))
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "校正に失敗しました。");
      return undefined;
    }
  }, [calibration, cameraMode, frameCalibrations, samples]);
  const activeLine = detectedLines.find((line) => line.id === activeLineId);
  const hasTracks = Boolean(tracks && (tracks.left.length || tracks.right.length));

  function clearAnalysis() { setSamples([]); setFrameCalibrations([]); setAnalysisStats(undefined); }
  function resetCalibration() { setImageCorners([]); setRinkCornersM([]); setReferenceTimestampMs(0); clearAnalysis(); }
  function setReferenceFrame(video: HTMLVideoElement) { setReferenceTimestampMs(Math.round(video.currentTime * 1000)); }
  function updatePlaybackTime() { if (videoRef.current) setPlaybackTimestampMs(Math.round(videoRef.current.currentTime * 1000)); }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(selected); setVideoUrl(URL.createObjectURL(selected)); setVideoSize(undefined); setPlaybackTimestampMs(0);
    resetCalibration(); setDetectedLines([]); setSelectedLineIds([]); setActiveLineId(undefined); setRinkLineReferences([]);
    setMessage("動画のラインを検出してリンク図へ割り当てるか、リンク外周の4点を指定してください。");
  }

  function addCorner(event: ReactMouseEvent<HTMLDivElement>) {
    const video = videoRef.current;
    if (!video || !videoSize || imageCorners.length === 4) return;
    const point = pointFromVideoStage(event, video);
    if (!point) { setMessage("黒い余白ではなく、映像上のリンク外周または明瞭なライン交点をタップしてください。"); return; }
    if (imageCorners.length === 0) setRinkCornersM(rinkBoundaryCorners(profile));
    if (imageCorners.length === 3) setReferenceFrame(video);
    setImageCorners((current) => [...current, point]); clearAnalysis();
  }

  function chooseProfile(id: RinkProfileId) {
    setRinkProfileId(id); resetCalibration(); setRinkLineReferences([]); setSelectedLineIds([]);
    setMessage("リンク規格を変更しました。動画のラインをもう一度、リンク図上の名称へ割り当ててください。");
  }

  function chooseCameraMode(mode: CameraMotionMode) {
    setCameraMode(mode); clearAnalysis();
    setMessage(mode === "rink-lines" ? "移動カメラ補正を選びました。基準フレームの4点を追跡して、フレームごとの射影変換を作ります。" : "固定カメラ補正を選びました。リンク座標を一度だけ確定します。");
  }

  function detectLines() {
    const video = videoRef.current;
    if (!video || !videoSize) return;
    try {
      const lines = detectHockeyLines(video);
      setDetectedLines(lines); setSelectedLineIds([]); setActiveLineId(lines[0]?.id); setRinkLineReferences([]);
      setMessage(`${lines.length}本の候補を検出しました。候補を選び、右のリンク図で実際のライン名を割り当ててください。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "ライン検出に失敗しました。"); }
  }

  function toggleLine(id: string) {
    setSelectedLineIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 2) { setMessage("射影変換に使える動画ラインは2本までです。"); return current; }
      return [...current, id];
    });
  }

  function assignRinkLine(rinkLineId: HockeyRinkLineId) {
    if (!activeLine) { setMessage("先に動画のライン候補を選択してください。"); return; }
    const target = RINK_LINES.find((line) => line.id === rinkLineId)!;
    if (target.color !== activeLine.color) { setMessage(`${target.label}は${target.color === "red" ? "赤線" : "青線"}です。動画候補と同じ色を選んでください。`); return; }
    setRinkLineReferences((current) => [
      ...current.filter((reference) => reference.rinkLineId !== rinkLineId && reference.videoLineId !== activeLine.id),
      { videoLineId: activeLine.id, rinkLineId, color: activeLine.color, start: activeLine.start, end: activeLine.end, score: activeLine.score }
    ]);
    setMessage(`「${target.label}」として登録しました。正しい2本に射影補正チェックを入れてください。`);
  }

  function useNamedLines() {
    const video = videoRef.current;
    const references = selectedLineIds.map((id) => rinkLineReferences.find((reference) => reference.videoLineId === id));
    if (!video || references.length !== 2 || references.some((item) => !item)) { setMessage("2本を選び、それぞれをリンク図のライン名へ割り当ててください。"); return; }
    const next = calibrationFromNamedLines(references as RinkLineReference[], rinkProfileId);
    if (!next) { setMessage("異なる2本のラインを割り当ててください。"); return; }
    setImageCorners(next.imageCorners); setRinkCornersM(next.rinkCornersM); setReferenceFrame(video); clearAnalysis();
    setMessage("選んだ2本を実リンク座標へ配置しました。薄いラインが動画上の実線と重なることを確認してから解析してください。");
  }

  async function runAnalysis() {
    const video = videoRef.current;
    if (!video || !calibration || !file) return;
    if (!Number.isFinite(video.duration)) { setMessage("動画の読み込み完了を待ってください。"); return; }
    setProgress(0);
    setMessage(cameraMode === "rink-lines" ? "足先と4つのリンク基準点を追跡し、フレームごとの射影変換でカメラ移動を補正しています。" : "足先を追跡しています。");
    try {
      const result = await analyseVideo(video, { calibration, cameraMode, referenceTimestampMs, onProgress: setProgress });
      if (cameraMode === "rink-lines" && result.stabilizedFrames === 0) throw new Error("ラインを追跡できませんでした。ライン端または交点が明瞭な基準フレームで校正してください。");
      setSamples(result.samples); setFrameCalibrations(result.frameCalibrations); setAnalysisStats({ totalFrames: result.totalFrames, stabilizedFrames: result.stabilizedFrames });
      setMessage(cameraMode === "rink-lines" ? `射影補正 ${result.stabilizedFrames}/${result.totalFrames} フレーム。追跡不能なフレームは軌跡から除外しました。` : "軌跡を生成しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "解析に失敗しました。"); }
    finally { setProgress(undefined); }
  }

  function exportJson() {
    if (!tracks || !calibration || !file || !videoRef.current) return;
    const value: PatternJson = {
      schemaVersion: 2, source: { videoName: file.name, durationMs: Math.round(videoRef.current.duration * 1000) }, coordinateSystem: "rink-floor-local-metres", calibration, tracks,
      notes: ["F/Bは足先・かかとと移動方向から推定。I/Oは単眼動画では未確定。", "ホッケーラインをIIHFリンク座標へ対応付け、移動カメラ時は同じ4点を毎フレーム追跡して射影補正。"],
      ...(rinkLineReferences.length ? { rinkLineReferences } : {}),
      ...(cameraMode === "rink-lines" && analysisStats ? { cameraStabilization: { mode: cameraMode, referenceTimestampMs, stabilizedFrames: analysisStats.stabilizedFrames, totalFrames: analysisStats.totalFrames } } : {})
    };
    download("skate-pattern.json", value);
  }

  const width = videoSize?.width ?? 1; const height = videoSize?.height ?? 1; const scale = Math.max(width, height);
  return <main>
    <header><p className="eyebrow">VIDEO → RINK PATTERN → AR</p><h1>Skate Edge Trails</h1><p>動画のホッケーラインを実際のリンク座標へ対応付け、左右の足跡を実寸パターンへ変換します。</p></header>
    <section className="workflow">
      <label className="file-input"><span>1. 動画を選択</span><input accept="video/*" type="file" onChange={chooseFile} /></label>
      <label>リンク規格<select value={rinkProfileId} onChange={(event) => chooseProfile(event.target.value as RinkProfileId)}>{RINK_PROFILES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
      <label>撮影方法<select value={cameraMode} onChange={(event) => chooseCameraMode(event.target.value as CameraMotionMode)}><option value="fixed">固定カメラ</option><option value="rink-lines">移動カメラ（リンクライン補正）</option></select></label>
      <button type="button" className="secondary" onClick={() => { resetCalibration(); setMessage("手動ではリンク外周の4点を左奥→右奥→右手前→左手前で指定します。ラインだけが見える場合は、下で2本を割り当ててください。"); }} disabled={!imageCorners.length}>校正点をやり直す</button>
      <button type="button" onClick={runAnalysis} disabled={!calibration || !file || progress !== undefined}>2. 補正して軌跡を作る</button>
    </section>
    <p className="notice">{message}{progress !== undefined && ` ${Math.round(progress * 100)}%`}</p>
    <section className="content-grid">
      <article className="panel"><h2>動画とリンク座標</h2>
        {videoUrl ? <div className="video-stage" onClick={addCorner}><video ref={videoRef} src={videoUrl} controls playsInline onLoadedMetadata={() => { const video = videoRef.current; if (video) { setVideoSize({ width: video.videoWidth, height: video.videoHeight }); updatePlaybackTime(); } }} onTimeUpdate={updatePlaybackTime} onSeeked={updatePlaybackTime} />
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {displayedCalibration && <RinkProjectionOverlay calibration={displayedCalibration} width={width} height={height} />}
            {detectedLines.map((line) => <g key={line.id} opacity={activeLineId === line.id ? 1 : .56}><line x1={line.start.x * width} y1={line.start.y * height} x2={line.end.x * width} y2={line.end.y * height} stroke={line.color === "red" ? "#ff6e63" : "#4d97ff"} strokeWidth={scale * (selectedLineIds.includes(line.id) ? .007 : .004)} /><text x={line.start.x * width} y={line.start.y * height - scale * .012} fill="white" fontSize={scale * .024}>{candidateLabel(line, rinkLineReferences)}</text></g>)}
            {imageCorners.length > 1 && <polyline points={imageCorners.map((point) => `${point.x * width},${point.y * height}`).join(" ")} fill="none" stroke="#ffca62" strokeWidth={scale * .0035} />}
            {imageCorners.map((point, index) => <g key={`${point.x}-${point.y}-${index}`}><circle cx={point.x * width} cy={point.y * height} r={scale * .011} fill="#ffca62" /><text x={point.x * width + scale * .012} y={point.y * height - scale * .012} fill="white" fontSize={scale * .027}>{index + 1}</text></g>)}
          </svg></div> : <div className="empty">MP4などの動画を選択すると、ここに表示されます。</div>}
        <ol className="corner-list">{CORNER_NAMES.map((name, index) => <li key={name} className={imageCorners[index] ? "done" : ""}>{index + 1}. {name}</li>)}</ol>
        <LineCalibrationPanel disabled={!videoSize} candidates={detectedLines} selectedIds={selectedLineIds} activeId={activeLineId} activeLine={activeLine} references={rinkLineReferences} profile={profile} onDetect={detectLines} onActivate={setActiveLineId} onToggle={toggleLine} onAssign={assignRinkLine} onUse={useNamedLines} />
        {cameraMode === "rink-lines" && <p className="tracking-help">移動カメラでは基準フレーム（{formatTime(referenceTimestampMs)}）から解析します。黄色の4点を追跡し、再生位置に合わせて薄いホッケーラインの投影も更新します。</p>}
      </article>
      <article className="panel"><div className="panel-title"><h2>足軌跡パターン</h2><button type="button" className="secondary" onClick={exportJson} disabled={!hasTracks}>JSONを書き出す</button></div>
        {hasTracks && tracks ? <PatternChart tracks={tracks} /> : <div className="empty">解析後、ここに左足・右足の軌跡がリンク座標（m）で描画されます。</div>}
        <p className="legend"><span className="left-dot" /> 左足　<span className="right-dot" /> 右足　→ は推定した前進／後進方向です。イン／アウトは推測で確定しません。</p>
        {cameraMode === "rink-lines" && analysisStats && <p className="tracking-result">射影補正率: {analysisStats.stabilizedFrames}/{analysisStats.totalFrames} フレーム</p>}
      </article>
    </section>
    <TaskDatasetPanel tracks={hasTracks ? tracks : undefined} videoName={file?.name} />
  </main>;
}

function LineCalibrationPanel({ disabled, candidates, selectedIds, activeId, activeLine, references, profile, onDetect, onActivate, onToggle, onAssign, onUse }: { disabled: boolean; candidates: DetectedVideoLine[]; selectedIds: string[]; activeId?: string; activeLine?: DetectedVideoLine; references: RinkLineReference[]; profile: RinkProfile; onDetect: () => void; onActivate: (id: string) => void; onToggle: (id: string) => void; onAssign: (id: HockeyRinkLineId) => void; onUse: () => void }) {
  const ready = selectedIds.length === 2 && selectedIds.every((id) => references.some((reference) => reference.videoLineId === id));
  return <section className="line-assist"><div className="panel-title"><h3>ライン検出・射影補正</h3><button type="button" className="secondary" onClick={onDetect} disabled={disabled}>動画のラインを検出</button></div>
    <p>① 動画候補を選ぶ　② 右の図で同じ色の実ライン名を割り当てる　③ 校正する2本を選ぶ、の順です。候補端点がボードとの交点に近いフレームを使ってください。</p>
    {candidates.length > 0 && <div className="line-assist-grid"><div className="candidate-list">{candidates.map((line) => <div key={line.id} className={`candidate-row ${activeId === line.id ? "active" : ""}`}><button type="button" onClick={() => onActivate(line.id)}><span className={`line-swatch ${line.color}`} />{candidateLabel(line, references)}</button><label><input type="checkbox" checked={selectedIds.includes(line.id)} onChange={() => onToggle(line.id)} />射影補正</label></div>)}</div><RinkDiagram activeLine={activeLine} profile={profile} references={references} onAssign={onAssign} /></div>}
    {candidates.length > 0 && <button type="button" onClick={onUse} disabled={!ready}>選んだ2本をリンク座標へ配置</button>}
  </section>;
}

function RinkDiagram({ activeLine, profile, references, onAssign }: { activeLine?: DetectedVideoLine; profile: RinkProfile; references: RinkLineReference[]; onAssign: (id: HockeyRinkLineId) => void }) {
  const x = (xM: number) => 4 + xM / profile.lengthM * 92;
  const y = (yM: number) => 4 + yM / profile.widthM * 46;
  return <div className="rink-diagram"><p>{activeLine ? `選択中: ${activeLine.color === "red" ? "赤線" : "青線"}候補。図の同色線を押して割り当てます。` : "動画候補を選択してください"}</p><svg viewBox="0 0 100 58" role="img" aria-label="IIHFホッケーリンクのライン図"><rect x="4" y="4" width="92" height="46" rx="10" fill="#f8fbfb" stroke="#244552" strokeWidth="1.2" /><circle cx="50" cy="27" r={4.55 / profile.widthM * 46} fill="none" stroke="#e05d5d" strokeWidth="1" opacity=".7" />
    {RINK_LINES.map((line) => (<g key={line.id} className={activeLine?.color === line.color ? "rink-line available" : "rink-line"} role="button" tabIndex={0} onClick={() => activeLine && onAssign(line.id)} onKeyDown={(event) => { if (activeLine && (event.key === "Enter" || event.key === " ")) onAssign(line.id); }}><line x1={x(line.xM)} y1={y(0)} x2={x(line.xM)} y2={y(profile.widthM)} stroke={line.color === "red" ? "#e05d5d" : "#3674c7"} strokeWidth={line.id === "center" ? "1.6" : "2.4"} /><text x={x(line.xM)} y="55" textAnchor="middle" fontSize="3.2">{references.some((reference) => reference.rinkLineId === line.id) ? "✓" : line.id === "center" ? "C" : line.id.includes("blue") ? "B" : "G"}</text></g>))}
  </svg></div>;
}

function RinkProjectionOverlay({ calibration, width, height }: { calibration: Calibration; width: number; height: number }) {
  try {
    const profile = rinkProfile(calibration.rinkProfile);
    const rinkToVideo = invertHomography(makeHomography(calibration));
    const projected = (point: Point) => { const image = project(point, rinkToVideo); return { x: image.x * width, y: image.y * height }; };
    const points = (items: Point[]) => items.map((item) => { const p = projected(item); return `${p.x},${p.y}`; }).join(" ");
    return <g className="projected-rink" pointerEvents="none"><polygon points={points(rinkBoundaryCorners(profile))} fill="rgba(86, 201, 186, .05)" stroke="#72eee0" strokeWidth={Math.max(width, height) * .003} strokeDasharray={`${Math.max(width, height) * .012} ${Math.max(width, height) * .008}`} />{RINK_LINES.map((line) => { const start = projected({ x: line.xM, y: 0 }); const end = projected({ x: line.xM, y: profile.widthM }); return <line key={line.id} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={line.color === "red" ? "#ff8d83" : "#67b8ff"} strokeWidth={Math.max(width, height) * (line.id === "center" ? .006 : .008)} opacity=".86" />; })}</g>;
  } catch { return null; }
}

function pointFromVideoStage(event: ReactMouseEvent<HTMLDivElement>, video: HTMLVideoElement): Point | undefined { if (!video.videoWidth || !video.videoHeight) return undefined; const bounds = event.currentTarget.getBoundingClientRect(); const sourceRatio = video.videoWidth / video.videoHeight; const stageRatio = bounds.width / bounds.height; const renderedWidth = sourceRatio > stageRatio ? bounds.width : bounds.height * sourceRatio; const renderedHeight = sourceRatio > stageRatio ? bounds.width / sourceRatio : bounds.height; const offsetX = (bounds.width - renderedWidth) / 2; const offsetY = (bounds.height - renderedHeight) / 2; const x = (event.clientX - bounds.left - offsetX) / renderedWidth; const y = (event.clientY - bounds.top - offsetY) / renderedHeight; return x < 0 || x > 1 || y < 0 || y > 1 ? undefined : { x, y }; }
function candidateLabel(line: DetectedVideoLine, references: RinkLineReference[]) { const reference = references.find((item) => item.videoLineId === line.id); const name = reference ? RINK_LINES.find((item) => item.id === reference.rinkLineId)?.label : undefined; return `${line.color === "red" ? "赤" : "青"}候補 ${line.id.split("-").at(-1)}${name ? ` → ${name}` : ""}`; }
function formatTime(timestampMs: number) { const seconds = Math.max(0, Math.round(timestampMs / 1000)); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function download(fileName: string, value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = fileName; link.click(); URL.revokeObjectURL(url); }

function PatternChart({ tracks }: { tracks: Record<Foot, MetricSample[]> }) { const all = [...tracks.left, ...tracks.right]; const minX = Math.min(...all.map((sample) => sample.positionM.x)); const maxX = Math.max(...all.map((sample) => sample.positionM.x)); const minY = Math.min(...all.map((sample) => sample.positionM.y)); const maxY = Math.max(...all.map((sample) => sample.positionM.y)); const padding = .35; const width = Math.max(1, maxX - minX + padding * 2); const height = Math.max(1, maxY - minY + padding * 2); const point = (sample: MetricSample) => `${sample.positionM.x - minX + padding},${sample.positionM.y - minY + padding}`; return <svg className="pattern-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="左右の足軌跡パターン"><rect x="0" y="0" width={width} height={height} fill="#f8fbfb" /><g opacity=".16" stroke="#355461" strokeWidth=".015">{Array.from({ length: Math.ceil(width) + 1 }, (_, index) => <line key={`x-${index}`} x1={index} y1="0" x2={index} y2={height} />)}{Array.from({ length: Math.ceil(height) + 1 }, (_, index) => <line key={`y-${index}`} x1="0" y1={index} x2={width} y2={index} />)}</g><Track samples={tracks.left} color="#e05d5d" project={point} label="左足スタート" /><Track samples={tracks.right} color="#3674c7" project={point} label="右足スタート" /></svg>; }
function Track({ samples, color, project, label }: { samples: MetricSample[]; color: string; project: (sample: MetricSample) => string; label: string }) { if (!samples.length) return null; const start = samples[0]; const [startX, startY] = project(start).split(","); return <g><polyline points={samples.map(project).join(" ")} fill="none" stroke={color} strokeWidth=".09" strokeLinecap="round" strokeLinejoin="round" /><circle cx={startX} cy={startY} r=".12" fill={color} /><text x={Number(startX) + .14} y={Number(startY) - .13} fontSize=".23" fill="#10212b">{label}</text>{samples.filter((_, index) => index > 0 && index % 16 === 0).map((sample) => { const [x, y] = project(sample).split(","); return <text key={sample.timestampMs} x={Number(x) + .06} y={Number(y) - .06} fontSize=".2" fill={color}>{sample.direction}</text>; })}</g>; }
