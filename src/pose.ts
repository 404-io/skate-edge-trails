import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { createRinkLineTracker } from "./lineTracking";
import type { Calibration, CameraMotionMode, FootSample, FrameCalibration } from "./model";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

const LEFT_HEEL = 29;
const RIGHT_HEEL = 30;
const LEFT_TOE = 31;
const RIGHT_TOE = 32;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

const asPoint = (landmark: { x: number; y: number }) => ({ x: landmark.x, y: landmark.y });

export type VideoAnalysisOptions = {
  calibration: Calibration;
  cameraMode: CameraMotionMode;
  referenceTimestampMs: number;
  onProgress: (progress: number) => void;
};

export type VideoAnalysisResult = {
  samples: FootSample[];
  frameCalibrations: FrameCalibration[];
  totalFrames: number;
  stabilizedFrames: number;
};

/** Runs pose tracking and, when requested, re-measures the rink-line quadrilateral in every frame. */
export async function analyseVideo(video: HTMLVideoElement, options: VideoAnalysisOptions): Promise<VideoAnalysisResult> {
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);
  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.55,
    minPosePresenceConfidence: 0.55,
    minTrackingConfidence: 0.55
  });

  const samples: FootSample[] = [];
  const frameCalibrations: FrameCalibration[] = [];
  const originalTime = video.currentTime;
  const fps = Math.min(15, Math.max(8, Math.round(video.videoHeight > 1080 ? 12 : 15)));
  const duration = video.duration;
  const startTime = options.cameraMode === "rink-lines" ? Math.max(0, options.referenceTimestampMs / 1000) : 0;
  if (startTime >= duration - 0.02) {
    landmarker.close();
    throw new Error("移動カメラ補正では、解析したい範囲の先頭付近でラインの4点を指定してください。");
  }

  try {
    await seek(video, startTime);
    const rinkLineTracker = options.cameraMode === "rink-lines" ? createRinkLineTracker(video, options.calibration.imageCorners) : undefined;
    let totalFrames = 0;

    for (let time = startTime; time < duration; time += 1 / fps) {
      await seek(video, time);
      const timestampMs = Math.round(time * 1000);
      totalFrames += 1;
      const frameCalibration = rinkLineTracker?.track(timestampMs);
      if (frameCalibration) frameCalibrations.push(frameCalibration);

      const result = landmarker.detectForVideo(video, timestampMs);
      const landmarks = result.landmarks[0];
      if (landmarks) {
        const leftVisibility = Math.min(landmarks[LEFT_TOE].visibility ?? 0, landmarks[LEFT_HEEL].visibility ?? 0);
        const rightVisibility = Math.min(landmarks[RIGHT_TOE].visibility ?? 0, landmarks[RIGHT_HEEL].visibility ?? 0);
        samples.push({
          foot: "left",
          timestampMs,
          toe: asPoint(landmarks[LEFT_TOE]),
          heel: asPoint(landmarks[LEFT_HEEL]),
          ankle: asPoint(landmarks[LEFT_ANKLE]),
          visibility: leftVisibility
        });
        samples.push({
          foot: "right",
          timestampMs,
          toe: asPoint(landmarks[RIGHT_TOE]),
          heel: asPoint(landmarks[RIGHT_HEEL]),
          ankle: asPoint(landmarks[RIGHT_ANKLE]),
          visibility: rightVisibility
        });
      }
      options.onProgress(Math.min(1, (time - startTime) / (duration - startTime)));
    }

    return {
      samples,
      frameCalibrations,
      totalFrames,
      stabilizedFrames: options.cameraMode === "rink-lines" ? frameCalibrations.length : totalFrames
    };
  } finally {
    landmarker.close();
    await seek(video, originalTime);
  }
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  const targetTime = Math.min(time, Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - targetTime) < 0.0005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      video.removeEventListener("seeked", finish);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", finish);
      video.removeEventListener("error", fail);
      reject(new Error("動画を読み込めませんでした。MP4（H.264）を試してください。"));
    };
    video.addEventListener("seeked", finish, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.currentTime = targetTime;
  });
}
