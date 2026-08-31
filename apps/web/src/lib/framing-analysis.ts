/**
 * Purely geometric framing analysis. Every input here is a coordinate a face-detection model
 * already produced (a bounding box, two eye positions) -- nothing in this file performs
 * detection itself, and nothing here reads expression, identity, or any signal beyond pixel
 * position. That boundary is what keeps this "mechanical framing advice" (compliance page's
 * words) rather than anything the no-affect-inference guardrail would need to catch.
 */

export interface FaceDetection {
  readonly boundingBox: {
    readonly originX: number;
    readonly originY: number;
    readonly width: number;
    readonly height: number;
  };
  /** [rightEye, leftEye] in frame pixel coordinates, matching MediaPipe's keypoint order. */
  readonly eyeKeypoints: readonly [{ x: number; y: number }, { x: number; y: number }];
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

export interface FramingVerdict {
  readonly centered: boolean;
  readonly distanceOk: boolean;
  readonly eyeLineOk: boolean;
  readonly messages: readonly string[];
}

const CENTER_TOLERANCE = 0.15; // fraction of frame width
const MIN_FACE_WIDTH_FRACTION = 0.25; // below this, too far away
const MAX_FACE_WIDTH_FRACTION = 0.55; // above this, too close
const EYE_LINE_MIN_FRACTION = 0.3; // fraction of frame height
const EYE_LINE_MAX_FRACTION = 0.45;

export function framingVerdict(detection: FaceDetection, frame: FrameSize): FramingVerdict {
  const messages: string[] = [];

  const boxCenterX = detection.boundingBox.originX + detection.boundingBox.width / 2;
  const frameCenterX = frame.width / 2;
  const centered = Math.abs(boxCenterX - frameCenterX) <= CENTER_TOLERANCE * frame.width;
  if (!centered) messages.push('Center yourself in the frame.');

  const faceWidthFraction = detection.boundingBox.width / frame.width;
  const distanceOk =
    faceWidthFraction >= MIN_FACE_WIDTH_FRACTION && faceWidthFraction <= MAX_FACE_WIDTH_FRACTION;
  if (faceWidthFraction > MAX_FACE_WIDTH_FRACTION) messages.push('Move back a little.');
  else if (faceWidthFraction < MIN_FACE_WIDTH_FRACTION) messages.push('Move closer to the camera.');

  const [rightEye, leftEye] = detection.eyeKeypoints;
  const eyeY = (rightEye.y + leftEye.y) / 2;
  const eyeYFraction = eyeY / frame.height;
  const eyeLineOk = eyeYFraction >= EYE_LINE_MIN_FRACTION && eyeYFraction <= EYE_LINE_MAX_FRACTION;
  if (eyeYFraction < EYE_LINE_MIN_FRACTION) messages.push('Raise your camera, or sit up a little.');
  else if (eyeYFraction > EYE_LINE_MAX_FRACTION) messages.push('Lower your camera slightly.');

  return { centered, distanceOk, eyeLineOk, messages };
}
