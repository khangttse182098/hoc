/**
 * Helpers for multiple-choice "anchors": the positions of the printed A/B/C/D
 * letters inside a question's rect, stored as fractions of that rect.
 */
import type { MultipleChoiceQuestion, NormPoint, NormRect } from './types';
import { clampNormRect } from '../pdf/coords';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Convert a page-normalized point into rect-relative anchor coordinates. */
export function toAnchor(rect: NormRect, point: NormPoint): NormPoint {
  return { x: clamp01((point.x - rect.x) / rect.w), y: clamp01((point.y - rect.y) / rect.h) };
}

/** Convert a rect-relative anchor back to page-normalized coordinates. */
export function anchorToPage(rect: NormRect, anchor: NormPoint): NormPoint {
  return { x: rect.x + anchor.x * rect.w, y: rect.y + anchor.y * rect.h };
}

/** True when the question has one anchor per option. */
export function hasAnchors(q: MultipleChoiceQuestion): q is MultipleChoiceQuestion & { anchors: NormPoint[] } {
  return Array.isArray(q.anchors) && q.anchors.length === q.options.length && q.anchors.length > 0;
}

/**
 * Grow `rect` (if needed) so that `point` lies inside it with `pad` of
 * breathing room, and re-express the existing anchors relative to the new
 * rect so they stay on the same spot of the page.
 */
export function extendRectToPoint(
  rect: NormRect,
  anchors: NormPoint[],
  point: NormPoint,
  pad: NormPoint,
): { rect: NormRect; anchors: NormPoint[] } {
  const inside =
    point.x - pad.x >= rect.x &&
    point.y - pad.y >= rect.y &&
    point.x + pad.x <= rect.x + rect.w &&
    point.y + pad.y <= rect.y + rect.h;
  if (inside) return { rect, anchors };
  const x0 = Math.min(rect.x, point.x - pad.x);
  const y0 = Math.min(rect.y, point.y - pad.y);
  const x1 = Math.max(rect.x + rect.w, point.x + pad.x);
  const y1 = Math.max(rect.y + rect.h, point.y + pad.y);
  const grown = clampNormRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  return { rect: grown, anchors: anchors.map((a) => toAnchor(grown, anchorToPage(rect, a))) };
}
