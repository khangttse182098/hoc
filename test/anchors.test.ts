import { describe, expect, it } from 'vitest';
import { anchorToPage, extendRectToPoint, hasAnchors, toAnchor } from '../src/model/anchors';
import type { MultipleChoiceQuestion } from '../src/model/types';

const rect = { x: 0.2, y: 0.4, w: 0.5, h: 0.1 };

describe('anchors', () => {
  it('round-trips between page and rect-relative coordinates', () => {
    const p = { x: 0.45, y: 0.45 };
    const a = toAnchor(rect, p);
    expect(a.x).toBeCloseTo(0.5, 12);
    expect(a.y).toBeCloseTo(0.5, 12);
    const back = anchorToPage(rect, a);
    expect(back.x).toBeCloseTo(p.x, 12);
    expect(back.y).toBeCloseTo(p.y, 12);
  });

  it('clamps points outside the rect to its edges', () => {
    expect(toAnchor(rect, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(toAnchor(rect, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });

  it('keeps a rect that already contains the point (same object)', () => {
    const anchors = [{ x: 0.1, y: 0.5 }];
    const r = extendRectToPoint(rect, anchors, { x: 0.3, y: 0.45 }, { x: 0.01, y: 0.01 });
    expect(r.rect).toBe(rect);
    expect(r.anchors).toBe(anchors);
  });

  it('grows the rect to include an outside point and keeps old anchors on the same page spot', () => {
    const anchors = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }];
    const before = anchors.map((a) => anchorToPage(rect, a));
    const r = extendRectToPoint(rect, anchors, { x: 0.8, y: 0.6 }, { x: 0.02, y: 0.02 });
    expect(r.rect.x).toBeCloseTo(0.2);
    expect(r.rect.y).toBeCloseTo(0.4);
    expect(r.rect.x + r.rect.w).toBeCloseTo(0.82);
    expect(r.rect.y + r.rect.h).toBeCloseTo(0.62);
    r.anchors.forEach((a, i) => {
      const p = anchorToPage(r.rect, a);
      expect(p.x).toBeCloseTo(before[i].x, 12);
      expect(p.y).toBeCloseTo(before[i].y, 12);
    });
  });

  it('never grows past the page', () => {
    const r = extendRectToPoint(rect, [], { x: 0.999, y: 0.999 }, { x: 0.05, y: 0.05 });
    expect(r.rect.x + r.rect.w).toBeLessThanOrEqual(1);
    expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(1);
  });

  it('hasAnchors requires exactly one anchor per option', () => {
    const base: MultipleChoiceQuestion = { id: 'q', number: '1', pageIndex: 0, rect, points: 1, type: 'multiple-choice', options: ['A', 'B'], correct: 'A', layout: 'horizontal' };
    expect(hasAnchors(base)).toBe(false);
    expect(hasAnchors({ ...base, anchors: [{ x: 0, y: 0 }] })).toBe(false);
    expect(hasAnchors({ ...base, anchors: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe(true);
  });
});
