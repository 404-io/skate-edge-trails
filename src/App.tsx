import { type ChangeEvent, useMemo, useRef, useState } from "react";
import { makeMetricSamples, simplify } from "./geometry";
import { CalibrationStudio } from "./CalibrationStudio";
import type { Calibration, CameraMotionMode, Foot, FootSample, FrameCalibration, MetricSample, PatternJson, RinkLineReference, RinkProfileId } from "./model";
import { RINK_PROFILES } from "./rink";
import { analyseVideo } from "./pose";
import { TaskDatasetPanel } from "./TaskDatasetPanel";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File>();
  const [videoUrl, setVideoUrl] = useState<string>();
  const [studio, setStudio] = useState(false);
  const [rinkProfileId, setRinkProfileId] = useState<RinkProfileId>("iihf-60x30");
  const [cameraMode, setCameraMode] = useState<CameraMotionMode>("rink-lines");
  const [calibration, setCalibration] = useState<Calibration>();
  const [references, setReferences] = useState<RinkLineReference[]>([]);
  const [referenceTimestampMs, setReferenceTimestampMs] = useState(0);
  const [samples, setSamples] = useState<FootSample[]>([]);
  const [frames, setFrames] = useState<FrameCalibration[]>([]);
  const [analysisFrameCount, setAnalysisFrameCount] = useState(0);
  const [progress, setProgress] = useState<number>();
  const [message, setMessage] = useState("動画を選び、校正スタジオでリンクと対応付けてください。");

  const trackingPointCount = calibration?.trackingImagePoints?.length ?? 0;
  const analysisReady = Boolean(calibration && (cameraMode === "fixed" || trackingPointCount === 4));
  const tracks = useMemo<Record<Foot, MetricSample[]> | undefined>(() => {
    if (!calibration || !samples.length) return undefined;
    const left = simplify(makeMetricSamples(samples.filter((sample) => sample.foot === "left"), calibration, cameraMode === "rink-lines" ? frames : undefined));
    const right = simplify(makeMetricSamples(samples.filter((sample) => sample.foot === "right"), calibration, cameraMode === "rink-lines" ? frames : undefined));
    return left.length || right.length ? { left, right } : undefined;
  }, [calibration, cameraMode, frames, samples]);

  function clearAnalysis() {
    setFrames([]);
    setSamples([]);
    setAnalysisFrameCount(0);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setFile(selected);
    setVideoUrl(URL.createObjectURL(selected));
    setCalibration(undefined);
    setReferences([]);
    clearAnalysis();
    setMessage("動画を読み込みました。「校正スタジオを開く」からリンク線を対応付けます。");
  }

  async function analyse() {
    const video = videoRef.current;
    if (!video || !file || !calibration) return;
    if (!analysisReady) {
      setMessage("移動カメラ解析では、校正スタジオで画面内の追跡点を4点追加してください。");
      return;
    }
    setProgress(0);
    setMessage("足先とリンク基準を追跡しています。");
    try {
      const result = await analyseVideo(video, {
        calibration,
        cameraMode,
        referenceTimestampMs,
        onProgress: setProgress
      });
      setSamples(result.samples);
      setFrames(result.frameCalibrations);
      setAnalysisFrameCount(result.totalFrames);
      if (cameraMode === "rink-lines") {
        const coverage = result.totalFrames ? result.stabilizedFrames / result.totalFrames : 0;
        setMessage(
          coverage >= 0.7
            ? `射影補正を ${result.stabilizedFrames}/${result.totalFrames} フレーム（${Math.round(coverage * 100)}%）で完了しました。`
            : `補正できたのは ${result.stabilizedFrames}/${result.totalFrames} フレーム（${Math.round(coverage * 100)}%）です。交点など模様のある追跡点を選び直してください。`
        );
      } else {
        setMessage("固定カメラとして軌跡を作成しました。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "解析に失敗しました。");
    } finally {
      setProgress(undefined);
    }
  }

  function exportJson() {
    if (!tracks || !calibration || !file || !videoRef.current) return;
    const value: PatternJson = {
      schemaVersion: 2,
      source: { videoName: file.name, durationMs: Math.round(videoRef.current.duration * 1000) },
      coordinateSystem: "rink-floor-local-metres",
      calibration,
      tracks,
      rinkLineReferences: references,
      notes: [
        "校正スタジオで、実ホッケーライン2本と長辺ボードガイド2本から仮想四隅を生成。",
        "移動カメラ時は、画面内の4特徴点から仮想四隅をフレームごとに再投影。",
        "I/Oは単眼動画だけでは未確定であり、コーチ確認ラベルを学習データとして蓄積する。"
      ],
      ...(cameraMode === "rink-lines" ? {
        cameraStabilization: {
          mode: cameraMode,
          referenceTimestampMs,
          stabilizedFrames: frames.length,
          totalFrames: analysisFrameCount
        }
      } : {})
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "skate-pattern.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (studio && videoUrl) {
    return <CalibrationStudio
      videoUrl={videoUrl}
      videoRef={videoRef}
      rinkProfileId={rinkProfileId}
      onClose={() => setStudio(false)}
      onApply={(next, lineReferences, _size, timestamp) => {
        setCalibration(next);
        setReferences(lineReferences);
        setReferenceTimestampMs(timestamp);
        clearAnalysis();
        setStudio(false);
        setMessage(
          next.trackingImagePoints?.length === 4
            ? "リンク座標と移動追跡点を適用しました。メイン画面で軌跡解析を実行できます。"
            : "リンク座標を適用しました。固定カメラとしては解析できます。移動カメラでは校正スタジオで追跡点を4点追加してください。"
        );
      }}
    />;
  }

  return <main>
    <header>
      <p className="eyebrow">VIDEO → RINK PATTERN → AR</p>
      <h1>Skate Edge Trails</h1>
      <p>校正・解析・課題練習を分けたワークスペースです。</p>
    </header>
    <section className="workflow">
      <label className="file-input"><span>動画を選択</span><input accept="video/*" type="file" onChange={chooseFile} /></label>
      <label>リンク規格
        <select value={rinkProfileId} onChange={(event) => { setRinkProfileId(event.target.value as RinkProfileId); setCalibration(undefined); clearAnalysis(); }}>
          {RINK_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
        </select>
      </label>
      <label>撮影方法
        <select value={cameraMode} onChange={(event) => setCameraMode(event.target.value as CameraMotionMode)}>
          <option value="rink-lines">移動カメラ（リンクライン補正）</option>
          <option value="fixed">固定カメラ</option>
        </select>
      </label>
      <button type="button" onClick={() => setStudio(true)} disabled={!videoUrl}>校正スタジオを開く</button>
      <button type="button" onClick={analyse} disabled={!analysisReady || progress !== undefined}>軌跡を解析</button>
      <button type="button" className="secondary" onClick={exportJson} disabled={!tracks}>JSONを書き出す</button>
    </section>
    <p className="notice">{message}{progress !== undefined && ` ${Math.round(progress * 100)}%`}</p>
    {videoUrl && <video className="analysis-video-source" ref={videoRef} src={videoUrl} playsInline onLoadedMetadata={() => undefined} />}
    <section className="content-grid">
      <article className="panel">
        <h2>校正</h2>
        <p>{calibration ? "設定済み：画面外を含む仮想四隅から射影変換を作成します。" : "未設定：校正スタジオで、実ライン2本と長辺ボードガイド2本を描いてください。"}</p>
        {cameraMode === "rink-lines" && calibration && <p className="task-note">移動追跡点: {trackingPointCount}/4 {trackingPointCount === 4 ? "（解析可能）" : "（4点そろうまで移動カメラ解析は開始しません）"}</p>}
        <button type="button" className="secondary" onClick={() => setStudio(true)} disabled={!videoUrl}>{calibration ? "校正を編集" : "校正を開始"}</button>
      </article>
      <article className="panel">
        <h2>足軌跡パターン</h2>
        {tracks ? <TrackChart tracks={tracks} /> : <div className="empty">解析後、リンク座標（m）の軌跡を表示します。</div>}
      </article>
    </section>
    <TaskDatasetPanel tracks={tracks} videoName={file?.name} />
  </main>;
}

function TrackChart({ tracks }: { tracks: Record<Foot, MetricSample[]> }) {
  const all = [...tracks.left, ...tracks.right];
  if (!all.length) return <div className="empty">十分に校正できた足先フレームがありません。校正または追跡点を確認してください。</div>;
  const minX = Math.min(...all.map((sample) => sample.positionM.x));
  const maxX = Math.max(...all.map((sample) => sample.positionM.x));
  const minY = Math.min(...all.map((sample) => sample.positionM.y));
  const maxY = Math.max(...all.map((sample) => sample.positionM.y));
  const padding = 0.35;
  const width = Math.max(1, maxX - minX + padding * 2);
  const height = Math.max(1, maxY - minY + padding * 2);
  const point = (sample: MetricSample) => `${sample.positionM.x - minX + padding},${sample.positionM.y - minY + padding}`;
  return <svg className="pattern-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="左足と右足のリンク座標軌跡">
    <rect width={width} height={height} fill="#f8fbfb" />
    <polyline points={tracks.left.map(point).join(" ")} fill="none" stroke="#e05d5d" strokeWidth=".09" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points={tracks.right.map(point).join(" ")} fill="none" stroke="#3674c7" strokeWidth=".09" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
