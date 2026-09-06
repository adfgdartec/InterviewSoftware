'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { FaceDetector } from '@mediapipe/tasks-vision';
import { framingVerdict, type FramingVerdict } from '../lib/framing-analysis.js';
import {
  summarizePresence,
  type PresenceSample,
  type PresenceSummary,
} from '../lib/presence-analysis.js';

/**
 * Continuous camera framing analysis for the length of a round.
 *
 * `CameraFramingCheck` answered "is my camera set up right?" once, before starting. This
 * answers "did my framing hold while I was actually talking?", which is the part a candidate
 * cannot check themselves -- you cannot watch your own framing and answer a question at the
 * same time.
 *
 * Three properties, all load-bearing:
 *
 * 1. No frame, image or video ever leaves the browser. `detectForVideo` runs against a WASM
 *    model in this tab; what crosses any boundary is at most a handful of ratios and counts.
 *    There is nothing to upload, so there is nothing to leak.
 * 2. Purely geometric. Every judgement comes from `framingVerdict` (a bounding box and two
 *    eye positions) and `summarizePresence` (counts of those judgements). Nothing reads
 *    expression, gaze intent or attentiveness.
 * 3. Opt-in and stoppable. The stream starts on an explicit click and every track is stopped
 *    on unmount, on stop, and on tab close -- never left running behind a navigation.
 */

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.task';

/**
 * 2 Hz. Fast enough that a few seconds off-centre is caught, slow enough that a CPU-delegate
 * WASM model does not compete with the page while someone is trying to think.
 */
const SAMPLE_INTERVAL_MS = 500;

type Status = 'idle' | 'starting' | 'monitoring' | 'stopped' | 'error';

export interface CameraPresenceProps {
  /** Changing this ends the current round's monitoring and reports its summary. */
  readonly roundKey: string;
  readonly onSummary?: (summary: PresenceSummary) => void;
}

export function CameraPresence({ roundKey, onSummary }: CameraPresenceProps): ReactElement {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<FramingVerdict | null>(null);
  const [summary, setSummary] = useState<PresenceSummary | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const samplesRef = useRef<PresenceSample[]>([]);
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopEverything = useCallback((): void => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    detectorRef.current?.close?.();
    detectorRef.current = null;
  }, []);

  /** Ends monitoring and hands back the round's summary. Safe to call when not running. */
  const finish = useCallback((): void => {
    stopEverything();
    if (samplesRef.current.length === 0) {
      setStatus('idle');
      return;
    }
    const result = summarizePresence(samplesRef.current);
    samplesRef.current = [];
    setSummary(result);
    setLive(null);
    setStatus('stopped');
    onSummary?.(result);
  }, [onSummary, stopEverything]);

  // The camera must not outlive this component under any exit path, including a navigation
  // that unmounts without a click.
  useEffect(() => stopEverything, [stopEverything]);

  // Held in a ref so the round-change effect below can depend on `roundKey` ALONE. Taking
  // `finish` as a dependency would re-run it whenever the parent re-created `onSummary`,
  // ending monitoring in the middle of a round.
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // A new round is a new measurement. Close the previous one out rather than blending two
  // rounds' samples into one summary describing a habit that never happened.
  const previousRoundRef = useRef(roundKey);
  useEffect(() => {
    if (previousRoundRef.current === roundKey) return;
    previousRoundRef.current = roundKey;
    finishRef.current();
    setSummary(null);
  }, [roundKey]);

  function sampleOnce(): void {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (video === null || detector === null || video.videoWidth === 0) return;

    const atMs = performance.now() - startedAtRef.current;
    const result = detector.detectForVideo(video, performance.now());
    const detection = result.detections[0];
    const keypoints = detection?.keypoints;
    const box = detection?.boundingBox;

    if (detection === undefined || box === undefined || keypoints === undefined || keypoints.length < 2) {
      samplesRef.current.push({ atMs, verdict: null });
      setLive(null);
      return;
    }

    const frame = { width: video.videoWidth, height: video.videoHeight };
    // boundingBox is in pixels but keypoints are normalized 0-1 -- MediaPipe uses different
    // coordinate spaces for the two, and framingVerdict expects both in pixels. Converted
    // here, at the one place raw detector output enters this file.
    const toPixels = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: p.x * frame.width,
      y: p.y * frame.height,
    });

    const verdict = framingVerdict(
      {
        boundingBox: { originX: box.originX, originY: box.originY, width: box.width, height: box.height },
        eyeKeypoints: [toPixels(keypoints[0]!), toPixels(keypoints[1]!)],
      },
      frame,
    );
    samplesRef.current.push({ atMs, verdict });
    setLive(verdict);
  }

  async function start(): Promise<void> {
    setStatus('starting');
    setError(null);
    setSummary(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      detectorRef.current = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
      });

      samplesRef.current = [];
      startedAtRef.current = performance.now();
      timerRef.current = setInterval(sampleOnce, SAMPLE_INTERVAL_MS);
      setStatus('monitoring');
    } catch {
      setError('Could not access the camera. Check your browser permissions.');
      setStatus('error');
      stopEverything();
    }
  }

  const wellFramed =
    live !== null && live.centered && live.distanceOk && live.eyeLineOk;

  return (
    <details className="rounded-lg border border-room-rule bg-room-wall p-4">
      <summary className="label cursor-pointer text-room-ink-2 transition-colors hover:text-room-ink">
        Camera framing
      </summary>

      <div className="mt-3">
        <p className="max-w-[60ch] text-xs text-room-ink-2">
          Optional. Watches only where your head sits in the frame, entirely on this device —
          no image or video is ever uploaded. It produces framing advice, nothing about you.
        </p>

        {status === 'idle' || status === 'error' ? (
          <button type="button" onClick={() => void start()} className="btn btn-quiet mt-3">
            Watch my framing this round
          </button>
        ) : null}

        {status === 'starting' ? (
          <p className="mt-3 text-sm text-room-ink-2">Starting the camera…</p>
        ) : null}

        <video
          ref={videoRef}
          muted
          playsInline
          className={
            status === 'monitoring'
              ? 'mt-3 w-full max-w-xs rounded-lg border border-room-rule'
              : 'hidden'
          }
        />

        {status === 'monitoring' ? (
          <div className="mt-3">
            {/* A live readout, so the feedback is useful DURING the round rather than only
                after it. aria-live so it is announced rather than only seen. */}
            <p
              aria-live="polite"
              className={`label ${wellFramed ? 'text-success' : 'text-gold-600'}`}
            >
              {live === null
                ? 'No face in frame'
                : wellFramed
                  ? 'Framing looks good'
                  : (live.messages[0] ?? 'Adjust your framing')}
            </p>
            <button type="button" onClick={finish} className="btn btn-quiet mt-3">
              Stop and summarise
            </button>
          </div>
        ) : null}

        {error !== null ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        {summary !== null ? (
          <div className="mt-4 border-t border-room-rule pt-3">
            <p className="label text-room-ink-2">This round</p>
            <p className="data mt-1 text-2xl text-room-ink">
              {Math.round(summary.wellFramedRatio * 100)}%
              <span className="ml-2 text-xs text-room-ink-2">well framed</span>
            </p>
            <p className="mt-1 text-xs text-room-ink-2">
              {summary.sampleCount} samples · {summary.driftEvents} framing{' '}
              {summary.driftEvents === 1 ? 'shift' : 'shifts'}
            </p>
            {summary.notes.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-room-ink-2">
                {summary.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
