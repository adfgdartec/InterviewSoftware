/**
 * The MediaPipe assets the camera components load, in ONE place.
 *
 * They lived in two components and drifted: both carried a `.task` path under version `1`
 * that returns 404, so the detector never loaded and framing analysis silently did nothing
 * while the UI reported a permissions problem. One constant cannot drift from itself.
 *
 * Both are fixed, versioned, publicly documented third-party asset URLs -- the same file for
 * every user, never combined with anything user- or session-specific. That distinction is
 * what separates them from the pattern guardrail 6 forbids (a bucket host concatenated with a
 * per-user object key, which is how the audited prototype leaked private video).
 */

/** WASM runtime for the vision tasks. Pinned to the installed @mediapipe/tasks-vision. */
export const MEDIAPIPE_WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';

/**
 * Short-range face detector, ~200KB: a bounding box and sparse keypoints. No expression and
 * no identity output, which is what keeps this "mechanical framing advice" rather than
 * anything the no-affect-inference guardrail exists to catch.
 */
export const FACE_DETECTOR_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';
