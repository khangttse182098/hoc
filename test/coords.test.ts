import { describe, expect, it } from 'vitest';
import { clampNormRect, fitPageScale, fitWidthScale, isInsidePage, normToPx, pxToNorm, rectForDisplayRotation, rotateNormRect } from '../src/pdf/coords';
import { applyDelta } from '../src/ui/author/AuthorField';

const a4 = { width: 595.28, height: 841.89 };

describe('normalized <-> pixel transforms', () => {
  it('round-trips at several zoom levels', () => {
    const rect = { x: 0.123, y: 0.456, w: 0.2, h: 0.03 };
    for (const scale of [0.5, 1, 1.37, 2, 3.5]) {
      const px = normToPx(rect, a4, scale);
      const back = pxToNorm(px, a4, scale);
      expect(back.x).toBeCloseTo(rect.x, 10);
      expect(back.y).toBeCloseTo(rect.y, 10);
      expect(back.w).toBeCloseTo(rect.w, 10);
      expect(back.h).toBeCloseTo(rect.h, 10);
    }
  });

  it('scales pixel positions linearly with zoom', () => {
    const rect = { x: 0.5, y: 0.25, w: 0.1, h: 0.1 };
    const p1 = normToPx(rect, a4, 1);
    const p2 = normToPx(rect, a4, 2);
    expect(p2.left).toBeCloseTo(p1.left * 2);
    expect(p2.top).toBeCloseTo(p1.top * 2);
    expect(p2.width).toBeCloseTo(p1.width * 2);
    expect(p1.left).toBeCloseTo(a4.width / 2);
  });

  it('is independent of page size for the same normalized rect', () => {
    const rect = { x: 0.5, y: 0.5, w: 0.1, h: 0.1 };
    const letter = { width: 612, height: 792 };
    expect(normToPx(rect, letter, 1).left).toBeCloseTo(306);
    expect(normToPx(rect, a4, 1).left).toBeCloseTo(297.64);
  });
});

describe('clampNormRect / isInsidePage', () => {
  it('keeps rects inside the page', () => {
    expect(clampNormRect({ x: -0.2, y: 0.95, w: 0.3, h: 0.2 })).toEqual({ x: 0, y: 0.8, w: 0.3, h: 0.2 });
    expect(isInsidePage(clampNormRect({ x: 2, y: 2, w: 5, h: 5 }))).toBe(true);
  });
  it('enforces a minimum size', () => {
    const r = clampNormRect({ x: 0.5, y: 0.5, w: 0, h: -1 });
    expect(r.w).toBeGreaterThan(0);
    expect(r.h).toBeGreaterThan(0);
  });
  it('isInsidePage rejects overflow', () => {
    expect(isInsidePage({ x: 0.9, y: 0, w: 0.2, h: 0.1 })).toBe(false);
    expect(isInsidePage({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
  });
});

describe('rotation', () => {
  const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 };
  it('four quarter turns return to the start', () => {
    let cur = r;
    for (let i = 0; i < 4; i++) cur = rotateNormRect(cur, 90);
    expect(cur.x).toBeCloseTo(r.x);
    expect(cur.y).toBeCloseTo(r.y);
    expect(cur.w).toBeCloseTo(r.w);
    expect(cur.h).toBeCloseTo(r.h);
  });
  it('90 then -90 is identity and swaps width/height', () => {
    const once = rotateNormRect(r, 90);
    expect(once.w).toBeCloseTo(r.h);
    expect(once.h).toBeCloseTo(r.w);
    const back = rotateNormRect(once, -90);
    expect(back).toEqual(r);
  });
  it('maps the top-left corner to the top-right on a clockwise turn', () => {
    const tl = rotateNormRect({ x: 0, y: 0, w: 0.1, h: 0.1 }, 90);
    expect(tl.x).toBeCloseTo(0.9);
    expect(tl.y).toBeCloseTo(0);
  });
  it('rectForDisplayRotation applies the difference between stored and displayed rotation', () => {
    const page = { index: 0, width: 595, height: 842, rotation: 90 };
    expect(rectForDisplayRotation(r, page, 90)).toEqual(r);
    expect(rectForDisplayRotation(r, page, 180)).toEqual(rotateNormRect(r, 90));
  });
});

describe('fit scales', () => {
  it('fit width uses the widest page', () => {
    expect(fitWidthScale([a4, { width: 1000, height: 500 }], 1000, 0)).toBeCloseTo(1);
    expect(fitWidthScale([a4], 595.28 * 2 + 40, 20)).toBeCloseTo(2);
  });
  it('fit page respects height too', () => {
    expect(fitPageScale([a4], 10000, 841.89, 0)).toBeCloseTo(1);
  });
});

describe('applyDelta (drag/resize)', () => {
  const r = { x: 0.2, y: 0.2, w: 0.2, h: 0.1 };
  it('moves without changing size', () => {
    expect(applyDelta(r, 'move', 0.1, -0.05)).toEqual({ x: 0.30000000000000004, y: 0.15000000000000002, w: 0.2, h: 0.1 });
  });
  it('resizes from each handle', () => {
    expect(applyDelta(r, 'se', 0.1, 0.1)).toMatchObject({ x: 0.2, y: 0.2, w: 0.30000000000000004, h: 0.2 });
    const nw = applyDelta(r, 'nw', 0.05, 0.05);
    expect(nw.x).toBeCloseTo(0.25);
    expect(nw.w).toBeCloseTo(0.15);
    expect(nw.h).toBeCloseTo(0.05);
    expect(applyDelta(r, 'e', 0.1, 0.5).h).toBe(0.1);
  });
  it('flips when dragged past the opposite edge instead of going negative', () => {
    const flipped = applyDelta(r, 'e', -0.3, 0);
    expect(flipped.w).toBeGreaterThan(0);
    expect(flipped.x).toBeCloseTo(0.1);
  });
  it('clamps to the page', () => {
    const out = applyDelta(r, 'move', 5, 5);
    expect(isInsidePage(out)).toBe(true);
  });
});
