'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
// Type-only import: erased entirely at compile time, so this costs nothing in the bundle --
// the WASM loader itself is only pulled in by the dynamic `import()` inside startCamera(),
// which is what actually keeps it out of every page that doesn't render this component.
import type { FaceDetector } from '@mediapipe/tasks-vision';
import { framingVerdict, type FramingVerdict } from '../lib/framing-analysis.js';

// A short-range, ~200KB model: bounding box + sparse keypoints only, no expression or
// identity output. Loaded from the same hosts the @mediapipe/tasks-vision docs use --
// this component is not an Artifact, so it is not subject to the Artifact CDN allowlist.
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.task';

type Status = 'idle' | 'starting' | 'ready' | 'checked' | 'error';

/**
 * A one-time, opt-in camera framing check. No frame is ever uploaded: detection runs
 * entirely client-side (MediaPipe's WASM FaceDetector), and framingVerdict -- the only part
 * that decides what to tell the candidate -- is pure geometry over a bounding box and two
 * eye positions. The camera stream is stopped immediately when this component unmounts or
 * the check is dismissed; it is never left running in the background.
 */
export function CameraFramingCheck(): ReactElement {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<FramingVerdict | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetector | null>(null);

  function stopCamera(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => stopCamera, []);

  async function startCamera(): Promise<void> {
    setStatus('starting');
    setError(null);
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
      setStatus('ready');
    } catch {
      setError('Could not access the camera. Check your browser permissions.');
      setStatus('error');
      stopCamera();
    }
  }

  function checkFraming(): void {
    if (videoRef.current === null || detectorRef.current === null) return;
    const result = detectorRef.current.detectForVideo(videoRef.current, performance.now());
    const detection = result.detections[0];
    const keypoints = detection?.keypoints;
    if (detection === undefined || keypoints === undefined || keypoints.length < 2) {
      setError('No face detected. Make sure you’re visible in the camera.');
      return;
    }
    setError(null);
    const box = detection.boundingBox;
    if (box === undefined) {
      setError('No face detected. Make sure you’re visible in the camera.');
      return;
    }
    const frame = { width: videoRef.current.videoWidth, height: videoRef.current.videoHeight };
    // boundingBox is already in pixel coordinates, but keypoints are normalized (0-1)
    // relative to the frame -- MediaPipe's FaceDetector uses different coordinate spaces
    // for the two, and framingVerdict expects both in pixels. Converting here, once, at the
    // one place raw detector output enters this codebase, is what keeps that inconsistency
    // from becoming a silent bug in the geometry itself.
    const toPixels = (p: { x: number; y: number }): { x: number; y: number } => ({
      x: p.x * frame.width,
      y: p.y * frame.height,
    });
    setVerdict(
      framingVerdict(
        {
          boundingBox: { originX: box.originX, originY: box.originY, width: box.width, height: box.height },
          eyeKeypoints: [toPixels(keypoints[0]!), toPixels(keypoints[1]!)],
        },
        frame,
      ),
    );
    setStatus('checked');
  }

  function dismiss(): void {
    stopCamera();
    setOpen(false);
    setStatus('idle');
    setVerdict(null);
    setError(null);
  }

  return (
    <details
      className="mt-4 rounded-lg border border-neutral-200 bg-white p-4"
      open={open}
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        setOpen(isOpen);
        if (!isOpen) dismiss();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium text-plum-700">
        Check your camera framing
      </summary>

      <div className="mt-3">
        {status === 'idle' ? (
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-md border border-plum-700 px-3 py-1.5 text-sm font-medium text-plum-700 hover:bg-plum-100"
          >
            Start camera check
          </button>
        ) : null}

        {status === 'starting' ? <p className="text-sm text-neutral-600">Starting camera…</p> : null}

        <video
          ref={videoRef}
          muted
          playsInline
          className={status === 'ready' || status === 'checked' ? 'mt-2 w-full max-w-xs rounded-md' : 'hidden'}
        />

        {status === 'ready' || status === 'checked' ? (
          <button
            type="button"
            onClick={checkFraming}
            className="mt-3 rounded-md bg-plum-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-900"
          >
            {status === 'checked' ? 'Check again' : 'Check my framing'}
          </button>
        ) : null}

        {error !== null ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}

        {verdict !== null ? (
          <ul className="mt-3 space-y-1 text-sm">
            <li className={verdict.centered ? 'text-success' : 'text-neutral-900'}>
              {verdict.centered ? '✓ Centered' : '✗ Not centered'}
            </li>
            <li className={verdict.distanceOk ? 'text-success' : 'text-neutral-900'}>
              {verdict.distanceOk ? '✓ Good distance' : '✗ Distance needs adjusting'}
            </li>
            <li className={verdict.eyeLineOk ? 'text-success' : 'text-neutral-900'}>
              {verdict.eyeLineOk ? '✓ Eye line looks right' : '✗ Eye line needs adjusting'}
            </li>
          </ul>
        ) : null}
        {verdict !== null && verdict.messages.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-neutral-600">
            {verdict.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
