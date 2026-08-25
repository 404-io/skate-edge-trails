import { ChangeEvent, useMemo, useRef, useState } from "react";
import { makeMetricSamples, simplify } from "./geometry";
import type { Calibration, Foot, FootSample, MetricSample, PatternJson, Point } from "./model";
import { analyseVideo } from "./pose";

const CORNER_NAMES = ["左奥", "右奥", "右手前", "左手前"];

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File>();
  const [videoUrl, setVideoUrl] = useState<string>();
  const [corners, setCorners] = useState<Point[]>([]);
  const [widthM, setWidthM] = useState(6);
  const [lengthM, setLengthM] = useState(8);
  const [samples, setSamples] = useState<FootSample[]>([]);
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("動画を選び、ホッケーラインの交点を4点指定してください。");

  const calibration: Calibration | undefined = corners.length === 4 ? { imageCorners: corners, widthM, lengthM } : undefined;
  const tracks = useMemo<Record<Foot, MetricSample[]> | undefined>(() => {
    if (!calibration || samples.length === 0) return undefined;
    try {
      return {
        left: simplify(makeMetricSamples(samples.filter((sample) => sample.foot === "left"), calibration)),
        right: simplify(makeMetricSamples(samples.filter((sample) => sample.foot === "right"), calibration))
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "校正に失敗しました。");
      return undefined;
    }
  }, [calibration, samples]);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(selected);
    setVideoUrl(URL.createObjectURL(selected));
    setCorners([]);
    setSamples([]);
    setMessage("動画上で、既知サイズのホッケーライン長方形を左奥→右奥→右手前→左手前の順にタップしてください。");
  }

  function addCorner(event: React.MouseEvent<HTMLDivElement>) {
    if (corners.length === 4) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setCorners((current) => [...current, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }]);
  }

  async function runAnalysis() {
    const video = videoRef.current;
    if (!video || !calibration || !file) return;
    if (!Number.isFinite(video.duration)) {
      setMessage("動画の読み込み完了を待ってください。");
      return;
    }
    setProgress(0);
    setMessage("足先を追跡しています。長い動画では少し時間がかかります。");
    try {
      setSamples(await analyseVideo(video, setProgress));
      setMessage("軌跡を生成しました。I/Oエッジは、単眼動画だけでは確度不足のため未確定として扱います。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解析に失敗しました。");
    } finally {
      setProgress(undefined);
    }
  }

  function exportJson() {
    if (!tracks || !calibration || !file || !videoRef.current) return;
    const pattern: PatternJson = {
      schemaVersion: 1,
      source: { videoName: file.name, durationMs: Math.round(videoRef.current.duration * 1000) },
      coordinateSystem: "rink-floor-local-metres",
      calibration,
      tracks,
      notes: ["F/Bは足先・かかとと移動方向から推定。I/Oは単眼動画では未確定。"]
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(pattern, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "skate-pattern.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <header>
        <p className="eyebrow">VIDEO → RINK PATTERN → AR</p>
        <h1>Skate Edge Trails</h1>
        <p>動画から左右の足跡を取り出し、ホッケーラインを基準に実寸のパターン表へ変換します。</p>
      </header>

      <section className="workflow">
        <label className="file-input">
          <span>1. 動画を選択</span>
          <input accept="video/*" type="file" onChange={chooseFile} />
        </label>
        <label>校正幅（m）<input type="number" min="0.5" step="0.1" value={widthM} onChange={(event) => setWidthM(Number(event.target.value))} /></label>
        <label>校正奥行（m）<input type="number" min="0.5" step="0.1" value={lengthM} onChange={(event) => setLengthM(Number(event.target.value))} /></label>
        <button type="button" className="secondary" onClick={() => setCorners([])} disabled={corners.length === 0}>校正点をやり直す</button>
        <button type="button" onClick={runAnalysis} disabled={!calibration || !file || progress !== undefined}>2. 軌跡を作る</button>
      </section>

      <p className="notice">{message}{progress !== undefined && ` ${Math.round(progress * 100)}%`}</p>

      <section className="content-grid">
        <article className="panel">
          <h2>動画とリンク校正</h2>
          {videoUrl ? (
            <div className="video-stage" onClick={addCorner}>
              <video ref={videoRef} src={videoUrl} controls playsInline />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                {corners.length > 1 && <polyline points={corners.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#ffca62" strokeWidth="0.008" />}
                {corners.map((point, index) => (
                  <g key={`${point.x}-${point.y}`}>
                    <circle cx={point.x} cy={point.y} r="0.023" fill="#ffca62" />
                    <text x={point.x + 0.012} y={point.y - 0.012} fill="white" fontSize="0.04">{index + 1}</text>
                  </g>
                ))}
              </svg>
            </div>
          ) : <div className="empty">MP4などの動画を選択すると、ここに表示されます。</div>}
          <ol className="corner-list">
            {CORNER_NAMES.map((name, index) => <li key={name} className={corners[index] ? "done" : ""}>{index + 1}. {name}</li>)}
          </ol>
        </article>

        <article className="panel">
          <div className="panel-title"><h2>足軌跡パターン</h2><button type="button" className="secondary" onClick={exportJson} disabled={!tracks}>JSONを書き出す</button></div>
          {tracks ? <PatternChart tracks={tracks} /> : <div className="empty">解析後、ここに左足・右足の軌跡が実寸で描画されます。</div>}
          <p className="legend"><span className="left-dot" /> 左足　<span className="right-dot" /> 右足　→ は推定した前進／後進方向です。イン／アウトは推測で確定しません。</p>
        </article>
      </section>
    </main>
  );
}

function PatternChart({ tracks }: { tracks: Record<Foot, MetricSample[]> }) {
  const all = [...tracks.left, ...tracks.right];
  const minX = Math.min(...all.map((sample) => sample.positionM.x));
  const maxX = Math.max(...all.map((sample) => sample.positionM.x));
  const minY = Math.min(...all.map((sample) => sample.positionM.y));
  const maxY = Math.max(...all.map((sample) => sample.positionM.y));
  const padding = 0.35;
  const width = Math.max(1, maxX - minX + padding * 2);
  const height = Math.max(1, maxY - minY + padding * 2);
  const project = (sample: MetricSample) => `${sample.positionM.x - minX + padding},${sample.positionM.y - minY + padding}`;
  const endpoint = (samples: MetricSample[]) => samples.at(-1);

  return (
    <svg className="pattern-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="左右の足軌跡パターン">
      <rect x="0" y="0" width={width} height={height} fill="#f8fbfb" />
      <g opacity="0.16" stroke="#355461" strokeWidth="0.015">
        {Array.from({ length: Math.ceil(width) + 1 }, (_, index) => <line key={`x-${index}`} x1={index} y1="0" x2={index} y2={height} />)}
        {Array.from({ length: Math.ceil(height) + 1 }, (_, index) => <line key={`y-${index}`} x1="0" y1={index} x2={width} y2={index} />)}
      </g>
      <Track samples={tracks.left} color="#e05d5d" project={project} label="左足スタート" />
      <Track samples={tracks.right} color="#3674c7" project={project} label="右足スタート" />
      {[endpoint(tracks.left), endpoint(tracks.right)].filter(Boolean).map((sample) => sample && <circle key={`${sample.foot}-end`} cx={sample.positionM.x - minX + padding} cy={sample.positionM.y - minY + padding} r="0.1" fill="none" stroke="#10212b" strokeWidth="0.035" />)}
    </svg>
  );
}

function Track({ samples, color, project, label }: { samples: MetricSample[]; color: string; project: (sample: MetricSample) => string; label: string }) {
  if (samples.length === 0) return null;
  const start = samples[0];
  return (
    <g>
      <polyline points={samples.map(project).join(" ")} fill="none" stroke={color} strokeWidth="0.09" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={project(start).split(",")[0]} cy={project(start).split(",")[1]} r="0.12" fill={color} />
      <text x={Number(project(start).split(",")[0]) + 0.14} y={Number(project(start).split(",")[1]) - 0.13} fontSize="0.23" fill="#10212b">{label}</text>
      {samples.filter((_, index) => index > 0 && index % 16 === 0).map((sample) => <text key={sample.timestampMs} x={Number(project(sample).split(",")[0]) + 0.06} y={Number(project(sample).split(",")[1]) - 0.06} fontSize="0.2" fill={color}>{sample.direction}</text>)}
    </g>
  );
}

export default App;

