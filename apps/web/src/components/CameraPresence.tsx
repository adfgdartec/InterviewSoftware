'use client';

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { FaceDetector } from '@mediapipe/tasks-vision';
import { FACE_DETECTOR_MODEL_URL, MEDIAPIPE_WASM_BASE } from '../lib/mediapipe-assets.js';
import { framingVerdict, type FramingVerdict } from '../lib/framing-analysis.js';
import {
  summarizePresence,
  type PresenceSample,
  type PresenceSummary,
} from '../lib/presence-analysis.js';


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

  /**
   * Two failures with completely different causes and completely different fixes, so they
   * get separate handling. One catch around both reported a failed model download as
   * "check your browser permissions", which sends someone to the one setting that was never
   * the problem -- and hid, during development, that the camera had opened fine.
   */
  async function start(): Promise<void> {
    setStatus('starting');
    setError(null);
    setSummary(null);

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch {
      setError('Could not access the camera. Check your browser permissions for this site.');
      setStatus('error');
      stopEverything();
      return;
    }

    try {
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
      detectorRef.current = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_DETECTOR_MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
      });
    } catch (cause) {
      // The camera itself is fine; only the analysis could not load. Say so, and show the
      // self-view anyway -- seeing yourself is worth having even without the framing advice.
      console.error('[camera] framing model failed to load:', cause);
      setError('Your camera is on, but the framing analysis could not load. Check your connection.');
      setStatus('monitoring');
      return;
    }

    // The <video> element only exists in the monitoring branch of the render, so the stream
    // cannot be attached here -- videoRef is still null at this point. Flipping the status
    // mounts the element; the effect below attaches the stream once it exists.
    setStatus('monitoring');
  }

  // Attaches the stream and starts sampling once the <video> element is actually mounted.
  // Splitting this from `start` is what makes the self-view work: the element does not exist
  // until `status` becomes 'monitoring', so assigning srcObject inside `start` silently did
  // nothing and the preview stayed black.
  useEffect(() => {
    if (status !== 'monitoring') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video === null || stream === null) return;

    video.srcObject = stream;
    void video.play().catch(() => {
      setError('The camera preview could not start.');
      setStatus('error');
    });

    samplesRef.current = [];
    startedAtRef.current = performance.now();
    // No detector means the self-view still runs; there is simply nothing to sample.
    if (detectorRef.current !== null) {
      timerRef.current = setInterval(sampleOnce, SAMPLE_INTERVAL_MS);
    }

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    // `sampleOnce` reads only refs, so it needs no dependency; re-running this on every
    // render would restart the sampling clock mid-round.
     
  }, [status]);

  const wellFramed =
    live !== null && live.centered && live.distanceOk && live.eyeLineOk;

  // Idle and error share a compact opt-in row; once the camera is live the self-view is the
  // point of the component, so it is NOT tucked behind a disclosure.
  if (status === 'idle' || status === 'error' || status === 'starting') {
    return (
      <div className="rounded-lg border border-room-rule bg-room-wall p-4">
        <p className="label text-room-ink-2">Camera</p>
        <p className="mt-2 max-w-[60ch] text-xs text-room-ink-2">
          Optional. Shows you your own camera while you answer, and watches only where your
          head sits in the frame. It all happens on this device — no image or video is ever
          uploaded. It produces framing advice, nothing about you.
        </p>
        {status === 'starting' ? (
          <p className="mt-3 text-sm text-room-ink-2">Starting the camera…</p>
        ) : (
          <button type="button" onClick={() => void start()} className="btn btn-quiet mt-3">
            Turn my camera on
          </button>
        )}
        {error !== null ? (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {summary !== null ? <RoundSummary summary={summary} /> : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-room-rule bg-room-wall p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* The self-view. A real interview puts your own face on screen, and seeing it is
            what lets someone actually act on the framing advice beside it. */}
        <div className="relative w-full shrink-0 overflow-hidden rounded-lg border border-room-rule bg-room-floor sm:w-64">
          <video
            ref={videoRef}
            muted
            playsInline
            // Mirrored, which is what every video call does: an unmirrored self-view makes
            // people correct their position the wrong way. Display only -- the detector reads
            // the element's real pixels, so the geometry is unaffected. (framingVerdict never
            // says "left" or "right", so nothing it reports is flipped by this either.)
            className={status === 'monitoring' ? 'block w-full bg-room-floor' : 'hidden'}
            // An inline transform rather than a utility class: the negative-scale utility did
            // not survive into the build, and a self-view that is not mirrored makes people
            // correct their position the wrong way.
            style={{ transform: 'scaleX(-1)' }}
          />
          {status === 'monitoring' ? (
            <span
              aria-hidden="true"
              className={`absolute left-2 top-2 h-2.5 w-2.5 rounded-full ${
                live === null ? 'bg-danger' : wellFramed ? 'bg-success' : 'bg-gold-600'
              }`}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <p className="label text-room-ink-2">Camera</p>
          {/* Live, so the feedback is useful DURING the round rather than only after it.
              aria-live so it is announced rather than only seen. */}
          <p
            aria-live="polite"
            className={`mt-1 text-sm font-medium ${
              live === null ? 'text-room-ink-2' : wellFramed ? 'text-success' : 'text-gold-600'
            }`}
          >
            {live === null
              ? 'No face in frame'
              : wellFramed
                ? 'Framing looks good'
                : (live.messages[0] ?? 'Adjust your framing')}
          </p>
          <p className="mt-2 text-xs text-room-ink-2">
            Nothing is uploaded. This runs entirely on your device.
          </p>
          <button type="button" onClick={finish} className="btn btn-quiet mt-3">
            Turn camera off
          </button>
        </div>
      </div>
      {summary !== null ? <RoundSummary summary={summary} /> : null}
    </div>
  );
}

/** The round's framing summary, shown after the camera stops. */
function RoundSummary({ summary }: { summary: PresenceSummary }): ReactElement {
  return (
    <div className="mt-4 border-t border-room-rule pt-3">
      <p className="label text-room-ink-2">Last round</p>
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
  );
}
