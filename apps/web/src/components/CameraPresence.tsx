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

/**
 * Whether the camera starts itself. It used to be off until the candidate found a button
 * below the submit control, which meant the framing coaching existed but effectively never
 * ran -- a rehearsal for a video interview that was not, itself, a video interview.
 *
 * On by default, and the choice is remembered: turning it off keeps it off for the next
 * round and the next session, because someone who declined once should not have to decline
 * every round. Stored per browser, never sent anywhere -- consistent with the rest of this
 * component, where no frame ever leaves the device.
 */
const PREFERENCE_KEY = 'lc.camera.enabled';

function preferredOn(): boolean {
  try {
    return window.localStorage.getItem(PREFERENCE_KEY) !== 'off';
  } catch {
    // Private windows and blocked site-data both throw here. Default to on rather than
    // letting a storage failure silently disable the feature.
    return true;
  }
}

function rememberPreference(on: boolean): void {
  try {
    window.localStorage.setItem(PREFERENCE_KEY, on ? 'on' : 'off');
  } catch {
    // Nothing to do: the preference simply does not persist for this viewer.
  }
}

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

  /** The candidate turning the camera off. Distinct from `finish`, which a round change
   *  also triggers: only an explicit "off" should stop it starting again next round. */
  const turnOff = useCallback((): void => {
    rememberPreference(false);
    finish();
  }, [finish]);

  // The camera must not outlive this component under any exit path, including a navigation
  // that unmounts without a click.
  useEffect(() => stopEverything, [stopEverything]);

  // Start without being asked, unless this browser has been told not to. Guarded by a ref so
  // React's development double-invoke cannot open two streams, and so a re-render during
  // `starting` never kicks off a second getUserMedia.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (preferredOn()) void start();
    // `start` is stable for this purpose: it only writes state and refs.
     
  }, []);

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
      <div className="rounded-xl border border-room-rule bg-room-wall p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="label text-room-ink-2">Camera</p>
            <p className="mt-1 text-base text-room-ink">
              {status === 'starting'
                ? 'Starting your camera…'
                : 'Your camera is off. Rehearsing on camera is the point of a video round.'}
            </p>
            <p className="mt-1 max-w-[58ch] text-sm text-room-ink-2">
              Nothing is uploaded. The video never leaves this device — only nine numbers
              about where your head sat in the frame are saved with the round.
            </p>
          </div>
          {status !== 'starting' ? (
            <button type="button" onClick={() => void start()} className="btn btn-primary shrink-0">
              Turn my camera on
            </button>
          ) : null}
        </div>
        {error !== null ? (
          <p role="alert" className="mt-4 border-l-2 border-danger pl-3 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {summary !== null ? <RoundSummary summary={summary} /> : null}
      </div>
    );
  }

  const checks: readonly { label: string; ok: boolean }[] =
    live === null
      ? []
      : [
          { label: 'Centred', ok: live.centered },
          { label: 'Distance', ok: live.distanceOk },
          { label: 'Eye line', ok: live.eyeLineOk },
        ];

  return (
    <div className="overflow-hidden rounded-xl border border-room-rule bg-room-wall">
      <div className="grid gap-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The self-view, at a size worth looking at. A real interview puts your own face on
            screen; seeing it is what lets anyone act on the advice beside it. */}
        <div className="relative aspect-[4/3] w-full bg-room-floor">
          <video
            ref={videoRef}
            muted
            playsInline
            // Mirrored, as every video call is: an unmirrored self-view makes people correct
            // their position the wrong way. Display only -- the detector reads the element's
            // real pixels, so the geometry is unaffected.
            className="h-full w-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
          <span
            className={`absolute left-3 top-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
              live === null
                ? 'bg-room-floor/85 text-room-ink-2'
                : wellFramed
                  ? 'bg-success/15 text-success'
                  : 'bg-gold-600/15 text-gold-600'
            }`}
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                live === null ? 'bg-room-ink-2' : wellFramed ? 'bg-success' : 'bg-gold-600'
              }`}
            />
            {live === null ? 'Looking for you' : wellFramed ? 'Well framed' : 'Adjust'}
          </span>
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-5 border-t border-room-rule p-5 sm:border-l sm:border-t-0">
          <div>
            <p className="label text-room-ink-2">Framing</p>
            {/* The one instruction worth acting on right now, at a size you can read from
                a normal sitting distance. aria-live so it is announced, not only seen. */}
            <p
              aria-live="polite"
              className={`mt-2 text-lg leading-snug ${
                live === null ? 'text-room-ink-2' : wellFramed ? 'text-success' : 'text-room-ink'
              }`}
            >
              {live === null
                ? 'No face in frame yet.'
                : wellFramed
                  ? 'Holding steady. Nothing to fix.'
                  : (live.messages[0] ?? 'Adjust your framing.')}
            </p>

            {checks.length > 0 ? (
              <ul className="mt-4 space-y-1.5">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-room-ink-2">{c.label}</span>
                    <span className={c.ok ? 'text-success' : 'text-gold-600'}>
                      {c.ok ? 'ok' : 'off'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            <p className="text-sm text-room-ink-2">
              Nothing is uploaded. This runs entirely on your device.
            </p>
            <button type="button" onClick={turnOff} className="btn btn-quiet mt-3">
              Turn camera off
            </button>
          </div>
        </div>
      </div>
      {summary !== null ? (
        <div className="border-t border-room-rule px-5 pb-5">
          <RoundSummary summary={summary} />
        </div>
      ) : null}
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
