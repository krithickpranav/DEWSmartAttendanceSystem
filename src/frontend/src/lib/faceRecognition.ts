/* eslint-disable @typescript-eslint/no-explicit-any */
import type { WorkerRecord } from "./db";

let faceapi: any = null;
let modelsLoaded = false;
let modelsLoading = false;

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";

export async function loadFaceModels(): Promise<boolean> {
  if (modelsLoaded) return true;
  if (modelsLoading) {
    while (modelsLoading) await new Promise((r) => setTimeout(r, 100));
    return modelsLoaded;
  }
  modelsLoading = true;
  try {
    // Load from CDN at runtime to avoid bundler resolution
    // biome-ignore lint/security/noGlobalEval: intentional CDN load
    const module = await new Function("url", "return import(url)")(
      "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.esm.js",
    );
    faceapi = module;
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
    return true;
  } catch (e) {
    console.error("Failed to load face models:", e);
    modelsLoaded = false;
    return false;
  } finally {
    modelsLoading = false;
  }
}

export function isModelsLoaded(): boolean {
  return modelsLoaded;
}

export async function extractEmbedding(
  video: HTMLVideoElement,
): Promise<Float32Array | null> {
  if (!modelsLoaded || !faceapi) return null;
  if (video.videoWidth === 0 || video.videoHeight === 0) return null;
  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 320,
      scoreThreshold: 0.4,
    });
    const result = await faceapi
      .detectSingleFace(video, options)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!result) return null;
    return result.descriptor as Float32Array;
  } catch {
    return null;
  }
}

export function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export interface MatchResult {
  worker: WorkerRecord;
  distance: number;
}

export function matchFace(
  liveEmbedding: Float32Array,
  workers: WorkerRecord[],
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const worker of workers) {
    if (!worker.faceEmbeddings || worker.faceEmbeddings.length === 0) continue;
    const distance = euclideanDistance(liveEmbedding, worker.faceEmbeddings);
    if (!best || distance < best.distance) {
      best = { worker, distance };
    }
  }
  if (best && best.distance < 0.5) return best;
  return null;
}

export interface FaceDetectionFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  timestamp: number;
}

export async function detectFaceBox(
  video: HTMLVideoElement,
): Promise<FaceDetectionFrame | null> {
  if (!modelsLoaded || !faceapi) return null;
  if (video.videoWidth === 0) return null;
  try {
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.3,
    });
    const result = await faceapi.detectSingleFace(video, options);
    if (!result) return null;
    return {
      x: result.box.x,
      y: result.box.y,
      width: result.box.width,
      height: result.box.height,
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

export function checkLiveness(
  frames: FaceDetectionFrame[],
  windowMs = 2000,
): boolean {
  if (frames.length < 4) return false;
  const now = Date.now();
  const recent = frames.filter((f) => now - f.timestamp < windowMs);
  if (recent.length < 4) return false;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const dx = Math.abs(last.x - first.x);
  const dy = Math.abs(last.y - first.y);
  return dx > 5 || dy > 5;
}

export async function averageEmbeddings(
  embeddings: Float32Array[],
): Promise<Float32Array> {
  if (embeddings.length === 0) return new Float32Array(128);
  const avg = new Float32Array(128);
  for (const emb of embeddings) {
    for (let i = 0; i < 128; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < 128; i++) avg[i] /= embeddings.length;
  return avg;
}
