import { describe, expect, it } from 'vitest';
import { framingVerdict, type FaceDetection, type FrameSize } from '../src/lib/framing-analysis.js';

const FRAME: FrameSize = { width: 640, height: 480 };

/** A face box centered horizontally, correctly sized, eyes on the guideline. */
function wellFramed(): FaceDetection {
  return {
    boundingBox: { originX: 224, originY: 120, width: 192, height: 192 }, // 30% of 640 wide
    eyeKeypoints: [
      { x: 280, y: 180 }, // ~37.5% of 480 tall
      { x: 360, y: 180 },
    ],
  };
}

describe('framingVerdict (purely geometric, no ML inference)', () => {
  it('passes all three checks for a well-framed face', () => {
    const v = framingVerdict(wellFramed(), FRAME);
    expect(v.centered).toBe(true);
    expect(v.distanceOk).toBe(true);
    expect(v.eyeLineOk).toBe(true);
    expect(v.messages).toHaveLength(0);
  });

  it('flags off-center to the left', () => {
    const d = wellFramed();
    const shifted: FaceDetection = {
      ...d,
      boundingBox: { ...d.boundingBox, originX: 0 },
      eyeKeypoints: [{ x: 56, y: 180 }, { x: 136, y: 180 }],
    };
    const v = framingVerdict(shifted, FRAME);
    expect(v.centered).toBe(false);
    expect(v.messages.some((m) => /center/i.test(m))).toBe(true);
  });

  it('flags too close (bounding box too large)', () => {
    const d = wellFramed();
    const close: FaceDetection = { ...d, boundingBox: { ...d.boundingBox, width: 450, height: 450 } };
    const v = framingVerdict(close, FRAME);
    expect(v.distanceOk).toBe(false);
    expect(v.messages.some((m) => /back/i.test(m))).toBe(true);
  });

  it('flags too far (bounding box too small)', () => {
    const d = wellFramed();
    const far: FaceDetection = { ...d, boundingBox: { ...d.boundingBox, width: 60, height: 60 } };
    const v = framingVerdict(far, FRAME);
    expect(v.distanceOk).toBe(false);
    expect(v.messages.some((m) => /closer/i.test(m))).toBe(true);
  });

  it('flags eyes too high in frame', () => {
    const d = wellFramed();
    const high: FaceDetection = { ...d, eyeKeypoints: [{ x: 280, y: 20 }, { x: 360, y: 20 }] };
    const v = framingVerdict(high, FRAME);
    expect(v.eyeLineOk).toBe(false);
  });

  it('flags eyes too low in frame', () => {
    const d = wellFramed();
    const low: FaceDetection = { ...d, eyeKeypoints: [{ x: 280, y: 400 }, { x: 360, y: 400 }] };
    const v = framingVerdict(low, FRAME);
    expect(v.eyeLineOk).toBe(false);
  });

  it('reports every failing check at once, not just the first', () => {
    const v = framingVerdict(
      {
        boundingBox: { originX: 500, originY: 0, width: 450, height: 450 },
        eyeKeypoints: [{ x: 510, y: 20 }, { x: 520, y: 20 }],
      },
      FRAME,
    );
    expect(v.centered).toBe(false);
    expect(v.distanceOk).toBe(false);
    expect(v.eyeLineOk).toBe(false);
    expect(v.messages.length).toBeGreaterThanOrEqual(3);
  });
});
