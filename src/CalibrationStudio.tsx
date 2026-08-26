import { type PointerEvent, type RefObject, useEffect, useMemo, useState } from "react";
import { invertHomography, makeHomography, project } from "./geometry";
import { detectHockeyLines } from "./hockeyLines";
import { calibrationFromNamedLines, RINK_LINES, rinkBoundaryCorners, rinkProfile } from "./rink";
import type { Calibration, HockeyRinkLineId, Point, RinkLineReference, RinkProfileId } from "./model";

type DrawingTool = "rink" | "board";
type Tool = DrawingTool | "tracking";
type DrawnLine = {
  id: string;
  role: DrawingTool;
  start: Point;
  end: Point;
  rinkLineId?: HockeyRinkLineId;
  color: string;
};
type Draft = { role: DrawingTool; start: Point; current: Point };

export function CalibrationStudio({
  videoUrl,
  videoRef,
  rinkProfileId,
  onApply,
  onClose
}: {
  videoUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  rinkProfileId: RinkProfileId;
  onApply: (
    calibration: Calibration,
    references: RinkLineReference[],
    videoSize: { width: number; height: number },
    timestampMs: number
  ) => void;
  onClose: () => void;
}) {
  const [videoSize, setVideoSize] = useState<{ width: number; height: number }>();
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<Tool>("rink");
  const [draft, setDraft] = useState<Draft>();
  const [lines, setLines] = useState<DrawnLine[]>([]);
  const [trackingPoints, setTrackingPoints] = useState<Point[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [message, setMessage] = useState(
    "ホッケーラインを2本、長辺ボードガイドを2本描いてください。線は画面外まで仮想的に延長して計算します。"
  );
  const profile = rinkProfile(rinkProfileId);
  const rinkLines = lines.filter((line) => line.role === "rink" && line.rinkLineId).slice(-2);
  const boardLines = lines.filter((line) => line.role === "board").slice(-2);
  const calibration = useMemo(() => {
    const references = rinkLines.map((line) => ({
      videoLineId: line.id,
      rinkLineId: line.rinkLineId!,
      color: RINK_LINES.find((item) => item.id === line.rinkLineId)!.color,
      start: line.start,
      end: line.end,
      score: 1
    }));
    return calibrationFromNamedLines(references, rinkProfileId, boardLines.flatMap((line) => [line.start, line.end]));
  }, [boardLines, rinkLines, rinkProfileId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setTime(video.currentTime);
      setPlaying(!video.paused);
    };
    video.addEventListener("timeupdate", sync);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
    };
  }, [videoRef]);

  function metadata() {
    const video = videoRef.current;
    if (!video) return;
    setVideoSize({ width: video.videoWidth, height: video.videoHeight });
    setDuration(video.duration);
  }

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play();
    else video.pause();
  }

  function seek(next: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || 0, next));
    setTime(video.currentTime);
  }

  function sourcePoint(event: PointerEvent<SVGSVGElement>): Point | undefined {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height
    };
  }

  function begin(event: PointerEvent<SVGSVGElement>) {
    const point = sourcePoint(event);
    if (!point) return;
    if (tool === "tracking") {
      if (trackingPoints.length >= 4) {
        setMessage("追跡点は4点までです。不要な点を戻してから選び直してください。");
        return;
      }
      setTrackingPoints((current) => [...current, point]);
      setMessage(`追跡点を追加しました（${trackingPoints.length + 1}/4）。交点・ボードとの接点など、模様があり画面内に残る点を選んでください。`);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ role: tool, start: point, current: point });
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const point = sourcePoint(event);
    if (point && draft) setDraft({ ...draft, current: point });
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    if (tool === "tracking") return;
    const point = sourcePoint(event);
    if (!point || !draft || Math.hypot(point.x - draft.start.x, point.y - draft.start.y) < 0.025) {
      setDraft(undefined);
      return;
    }
    const next: DrawnLine = {
      id: crypto.randomUUID(),
      role: draft.role,
      start: draft.start,
      end: point,
      color: draft.role === "board" ? "#ffd166" : "#79b8ff"
    };
    setLines((current) => [...current, next]);
    setSelectedId(next.id);
    setDraft(undefined);
    setMessage(
      draft.role === "board"
        ? "もう1本、反対側の長辺ボードガイドを描いてください。"
        : "描いた線を選択し、下で実際のホッケーライン名を指定してください。"
    );
  }

  function assignLine(id: string, rinkLineId: HockeyRinkLineId) {
    setLines((current) => current.map((line) => line.id === id
      ? {
          ...line,
          rinkLineId,
          color: RINK_LINES.find((item) => item.id === rinkLineId)!.color === "red" ? "#ff786d" : "#62a4ff"
        }
      : line));
  }

  function removeSelected() {
    setLines((current) => current.filter((line) => line.id !== selectedId));
    setSelectedId(undefined);
  }

  function autoDetect() {
    const video = videoRef.current;
    if (!video) return;
    try {
      const found = detectHockeyLines(video);
      const added = found.slice(0, 4).map<DrawnLine>((line) => ({
        id: crypto.randomUUID(),
        role: "rink",
        start: line.start,
        end: line.end,
        color: line.color === "red" ? "#ff786d" : "#62a4ff"
      }));
      setLines((current) => [...current, ...added]);
      setMessage("自動候補を追加しました。実際の線を選んで、ライン名を指定してください。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ライン検出に失敗しました。");
    }
  }

  function apply() {
    if (!calibration || !videoSize) {
      setMessage("実ライン名を持つホッケーライン2本と、長辺ボードガイド2本が必要です。");
      return;
    }
    const references = rinkLines.map((line) => ({
      videoLineId: line.id,
      rinkLineId: line.rinkLineId!,
      color: RINK_LINES.find((item) => item.id === line.rinkLineId)!.color,
      start: line.start,
      end: line.end,
      score: 1
    }));
    onApply(
      trackingPoints.length === 4 ? { ...calibration, trackingImagePoints: trackingPoints } : calibration,
      references,
      videoSize,
      Math.round(time * 1000)
    );
  }

  const selected = lines.find((line) => line.id === selectedId);
  const viewWidth = videoSize?.width ?? 1;
  const viewHeight = videoSize?.height ?? 1;

  return <main className="calibration-studio">
    <header>
      <p className="eyebrow">CALIBRATION STUDIO</p>
      <h1>動画とリンクを対応付ける</h1>
      <p>四隅が映らなくても、2本の実ホッケーラインと2本の長辺ガイドを無限直線として交差させ、画面外の仮想四隅からパース変形を作ります。</p>
      <p>移動カメラでは、さらに画面内の実特徴を4点選び、その移動だけを追跡します。</p>
    </header>
    <div className="studio-layout">
      <section className="studio-stage">
        <div className="studio-canvas">
          <video ref={videoRef} src={videoUrl} playsInline onLoadedMetadata={metadata} />
          <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} onPointerDown={begin} onPointerMove={move} onPointerUp={finish}>
            {calibration && <RinkOverlay calibration={calibration} width={viewWidth} height={viewHeight} />}
            {lines.map((line) => <line
              key={line.id}
              x1={line.start.x * viewWidth}
              y1={line.start.y * viewHeight}
              x2={line.end.x * viewWidth}
              y2={line.end.y * viewHeight}
              stroke={line.color}
              strokeWidth={selectedId === line.id ? Math.max(viewWidth, viewHeight) * 0.008 : Math.max(viewWidth, viewHeight) * 0.005}
              onPointerDown={(event) => { event.stopPropagation(); setSelectedId(line.id); }}
            />)}
            {trackingPoints.map((point, index) => <g key={`${point.x}-${point.y}-${index}`} pointerEvents="none">
              <circle cx={point.x * viewWidth} cy={point.y * viewHeight} r={Math.max(viewWidth, viewHeight) * 0.014} fill="#0e1d2e" stroke="#ffde70" strokeWidth={Math.max(viewWidth, viewHeight) * 0.004} />
              <text x={point.x * viewWidth} y={point.y * viewHeight} fill="#ffefb0" textAnchor="middle" dominantBaseline="central" fontSize={Math.max(viewWidth, viewHeight) * 0.022}>{index + 1}</text>
            </g>)}
            {draft && <line
              x1={draft.start.x * viewWidth}
              y1={draft.start.y * viewHeight}
              x2={draft.current.x * viewWidth}
              y2={draft.current.y * viewHeight}
              stroke={draft.role === "board" ? "#ffd166" : "#79b8ff"}
              strokeWidth={Math.max(viewWidth, viewHeight) * 0.005}
              strokeDasharray="12 8"
            />}
          </svg>
        </div>
        <div className="studio-playback">
          <button type="button" onClick={() => seek(time - 1 / 15)}>‹ 1フレーム</button>
          <button type="button" onClick={togglePlayback}>{playing ? "一時停止" : "再生"}</button>
          <button type="button" onClick={() => seek(time + 1 / 15)}>1フレーム ›</button>
          <input aria-label="動画シーク" type="range" min="0" max={duration || 1} step="0.01" value={time} onChange={(event) => seek(Number(event.target.value))} />
          <span>{formatTime(time)} / {formatTime(duration)}</span>
        </div>
      </section>
      <aside className="studio-tools">
        <h2>レイヤーとツール</h2>
        <p className="notice">{message}</p>
        <div className="tool-row">
          <button type="button" className={tool === "rink" ? "active-tool" : "secondary"} onClick={() => setTool("rink")}>実ホッケーラインを描く</button>
          <button type="button" className={tool === "board" ? "active-tool" : "secondary"} onClick={() => setTool("board")}>長辺ボードを描く</button>
          <button type="button" className={tool === "tracking" ? "active-tool" : "secondary"} onClick={() => setTool("tracking")}>移動追跡点を置く</button>
          <button type="button" className="secondary" onClick={autoDetect}>色ラインを自動検出</button>
        </div>
        <p className="notice">移動追跡点: {trackingPoints.length}/4。交点・ロゴ・ボードとの接点など、直線の途中ではない特徴を選びます。</p>
        <div className="tool-row">
          <button type="button" className="secondary" disabled={!trackingPoints.length} onClick={() => setTrackingPoints((current) => current.slice(0, -1))}>追跡点を1つ戻す</button>
          <button type="button" className="secondary" disabled={!trackingPoints.length} onClick={() => setTrackingPoints([])}>追跡点を消去</button>
        </div>
        <div className="studio-layer-list">
          {lines.map((line, index) => <div className={`studio-layer ${selectedId === line.id ? "selected" : ""}`} key={line.id}>
            <button type="button" onClick={() => setSelectedId(line.id)}>{index + 1}. {line.role === "board" ? "長辺ボード" : "ホッケーライン"}</button>
            {line.role === "rink" && <select value={line.rinkLineId ?? ""} onChange={(event) => assignLine(line.id, event.target.value as HockeyRinkLineId)}>
              <option value="">ライン名を選択</option>
              {RINK_LINES.filter((item) => !line.rinkLineId || item.color === RINK_LINES.find((candidate) => candidate.id === line.rinkLineId)?.color).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>}
          </div>)}
        </div>
        {selected && <button type="button" className="secondary" onClick={removeSelected}>選択レイヤーを削除</button>}
        <div className="studio-actions">
          <button type="button" className="secondary" onClick={onClose}>戻る</button>
          <button type="button" onClick={apply} disabled={!calibration}>この対応を適用</button>
        </div>
      </aside>
    </div>
  </main>;
}

function RinkOverlay({ calibration, width, height }: { calibration: Calibration; width: number; height: number }) {
  try {
    const profile = rinkProfile(calibration.rinkProfile);
    const rinkToVideo = invertHomography(makeHomography(calibration));
    const point = (p: Point) => project(p, rinkToVideo);
    const border = rinkBoundaryCorners(profile).map((p) => {
      const q = point(p);
      return `${q.x * width},${q.y * height}`;
    }).join(" ");
    return <g pointerEvents="none">
      <polygon points={border} fill="rgba(74, 217, 196, .06)" stroke="#72eee0" strokeWidth={Math.max(width, height) * 0.003} />
      {RINK_LINES.map((line) => {
        const a = point({ x: line.xM, y: 0 });
        const b = point({ x: line.xM, y: profile.widthM });
        return <line key={line.id} x1={a.x * width} y1={a.y * height} x2={b.x * width} y2={b.y * height} stroke={line.color === "red" ? "#ff8d83" : "#67b8ff"} strokeWidth={Math.max(width, height) * 0.007} />;
      })}
    </g>;
  } catch {
    return null;
  }
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}
