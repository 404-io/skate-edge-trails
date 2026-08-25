import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { FootSample } from "./model";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";

const LEFT_HEEL = 29;
const RIGHT_HEEL = 30;
const LEFT_TOE = 31;
const RIGHT_TOE = 32;
const LEFT_ANKLE = 27;
const RIGHT_ANKLE = 28;

const asPoint = (landmark: { x: number; y: number }) => ({ x: landmark.x, y: landmark.y });

export async function analyseVideo(
  video: HTMLVideoElement,
  onProgress: (progress: number) => void
): Promise<FootSample[]> {
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
  const originalTime = video.currentTime;
  const fps = Math.min(15, Math.max(8, Math.round(video.videoHeight > 1080 ? 12 : 15)));
  const duration = video.duration;

  for (let time = 0; time < duration; time += 1 / fps) {
    await seek(video, time);
    const result = landmarker.detectForVideo(video, Math.round(time * 1000));
    const landmarks = result.landmarks[0];
    if (landmarks) {
      const leftVisibility = Math.min(landmarks[LEFT_TOE].visibility ?? 0, landmarks[LEFT_HEEL].visibility ?? 0);
      const rightVisibility = Math.min(landmarks[RIGHT_TOE].visibility ?? 0, landmarks[RIGHT_HEEL].visibility ?? 0);
      samples.push({
        foot: "left",
        timestampMs: Math.round(time * 1000),
        toe: asPoint(landmarks[LEFT_TOE]),
        heel: asPoint(landmarks[LEFT_HEEL]),
        ankle: asPoint(landmarks[LEFT_ANKLE]),
        visibility: leftVisibility
      });
      samples.push({
        foot: "right",
        timestampMs: Math.round(time * 1000),
        toe: asPoint(landmarks[RIGHT_TOE]),
        heel: asPoint(landmarks[RIGHT_HEEL]),
        ankle: asPoint(landmarks[RIGHT_ANKLE]),
        visibility: rightVisibility
      });
    }
    onProgress(Math.min(1, time / duration));
  }

  await seek(video, originalTime);
  landmarker.close();
  return samples;
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
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
    video.currentTime = Math.min(time, Math.max(0, video.duration - 0.001));
  });
}

