/**
 * Coordinate transformations between normalized page space and CSS pixels.
 *
 * Normalized space: x, y, w, h are fractions of the displayed page box
 * (origin top-left, y grows downward), where the displayed page box is the
 * PDF.js viewport at scale 1 with the page's intrinsic rotation applied.
 *
 * Pixel space: CSS pixels relative to the top-left corner of the rendered page
 * element at a given zoom `scale` (CSS px per PDF point).
 */
import type { NormRect, PageInfo } from '../model/types';

export interface PxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageBox {
  width: number;
  height: number;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Size of the page in CSS pixels at the given scale. */
export function pageBoxAtScale(page: PageBox, scale: number): PageBox {
  return { width: page.width * scale, height: page.height * scale };
}

export function normToPx(rect: NormRect, page: PageBox, scale: number): PxRect {
  const box = pageBoxAtScale(page, scale);
  return {
    left: rect.x * box.width,
    top: rect.y * box.height,
    width: rect.w * box.width,
    height: rect.h * box.height,
  };
}

export function pxToNorm(px: PxRect, page: PageBox, scale: number): NormRect {
  const box = pageBoxAtScale(page, scale);
  return {
    x: px.left / box.width,
    y: px.top / box.height,
    w: px.width / box.width,
    h: px.height / box.height,
  };
}

/** Minimum overlay size in normalized units. */
export const MIN_NORM_SIZE = { w: 0.01, h: 0.005 };

/** Keep a rect fully inside the page and at least the minimum size. */
export function clampNormRect(rect: NormRect): NormRect {
  const w = clamp(rect.w, MIN_NORM_SIZE.w, 1);
  const h = clamp(rect.h, MIN_NORM_SIZE.h, 1);
  const x = clamp(rect.x, 0, 1 - w);
  const y = clamp(rect.y, 0, 1 - h);
  return { x, y, w, h };
}

export function isInsidePage(rect: NormRect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w > 0 &&
    rect.h > 0 &&
    rect.x + rect.w <= 1 + 1e-9 &&
    rect.y + rect.h <= 1 + 1e-9
  );
}

/**
 * Rotate a normalized rect by a multiple of 90 degrees clockwise. Used when the
 * stored page rotation differs from the one the page is displayed at (for
 * example if a future viewer lets the user rotate pages).
 */
export function rotateNormRect(rect: NormRect, degrees: number): NormRect {
  const turns = (((Math.round(degrees / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  switch (turns) {
    case 0:
      return { ...rect };
    case 1: // 90° clockwise: (x, y) -> (1 - y - h, x)
      return { x: 1 - rect.y - rect.h, y: rect.x, w: rect.h, h: rect.w };
    case 2:
      return { x: 1 - rect.x - rect.w, y: 1 - rect.y - rect.h, w: rect.w, h: rect.h };
    case 3: // 90° counter-clockwise
      return { x: rect.y, y: 1 - rect.x - rect.w, w: rect.h, h: rect.w };
  }
}

/** Convert a rect stored against `from` page info to the `to` display rotation. */
export function rectForDisplayRotation(rect: NormRect, from: PageInfo, toRotation: number): NormRect {
  return rotateNormRect(rect, toRotation - from.rotation);
}

/** The zoom scale needed so that the widest page fits the container width. */
export function fitWidthScale(pages: PageBox[], containerWidth: number, padding = 0): number {
  const maxW = pages.reduce((m, p) => Math.max(m, p.width), 0);
  if (maxW <= 0) return 1;
  return Math.max(0.1, (containerWidth - padding * 2) / maxW);
}

/** The zoom scale needed so that the tallest page fits the container height. */
export function fitPageScale(pages: PageBox[], containerWidth: number, containerHeight: number, padding = 0): number {
  const w = fitWidthScale(pages, containerWidth, padding);
  const maxH = pages.reduce((m, p) => Math.max(m, p.height), 0);
  if (maxH <= 0) return w;
  return Math.max(0.1, Math.min(w, (containerHeight - padding * 2) / maxH));
}
