/**
 * MediaPipe Pose Landmarker (Tasks Vision).
 *
 * Библиотека и модель берутся с CDN. После первого запуска браузер их
 * кэширует, но для самой первой загрузки нужен интернет.
 */

const BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const ESM_URL = `${BASE}/vision_bundle.mjs`;
const WASM_URL = `${BASE}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this.delegate = null;
    this.error = null;
    this.lastTs = -1;
    this.failures = 0;
  }

  get ready() {
    return !!this.landmarker;
  }

  async load(onProgress) {
    const say = (s) => {
      try {
        onProgress?.(s);
      } catch (_) {
        /* noop */
      }
    };

    say('Загружаю распознавание тела');
    let mod;
    try {
      mod = await import(/* @vite-ignore */ ESM_URL);
    } catch (e) {
      this.error = 'Не удалось загрузить библиотеку MediaPipe. Проверьте интернет.';
      throw e;
    }

    say('Готовлю вычислитель');
    let fileset;
    try {
      fileset = await mod.FilesetResolver.forVisionTasks(WASM_URL);
    } catch (e) {
      this.error = 'Не удалось загрузить WASM-модуль MediaPipe.';
      throw e;
    }

    let lastErr = null;
    for (const delegate of ['GPU', 'CPU']) {
      try {
        this.landmarker = await mod.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numPoses: 2,
          minPoseDetectionConfidence: 0.42,
          minPosePresenceConfidence: 0.42,
          minTrackingConfidence: 0.42,
        });
        this.delegate = delegate;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        this.landmarker = null;
      }
    }

    if (!this.landmarker) {
      this.error = 'Не удалось запустить модель распознавания. Попробуйте ещё раз.';
      throw lastErr || new Error('pose init failed');
    }
    say('Готово');
    return this;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {number} tsMs
   * @returns {Array<{x:number,y:number,z:number,visibility:number}>|null}
   */
  detect(video, tsMs) {
    if (!this.landmarker || !video || video.readyState < 2) return null;
    let ts = tsMs;
    if (!(ts > this.lastTs)) ts = this.lastTs + 1;
    try {
      const res = this.landmarker.detectForVideo(video, ts);
      this.lastTs = ts;
      this.failures = 0;
      const lms = (res?.landmarks || []).filter((lm) => lm && lm.length >= 29).slice(0, 2);
      return lms;
    } catch (_) {
      this.failures++;
      return null;
    }
  }

  close() {
    try {
      this.landmarker?.close();
    } catch (_) {
      /* noop */
    }
    this.landmarker = null;
  }
}
