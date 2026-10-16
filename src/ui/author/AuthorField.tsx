import { useRef, type PointerEvent } from 'react';
import type { NormPoint, NormRect, PageInfo, Question } from '../../model/types';
import { clampNormRect, normToPx, type PageBox } from '../../pdf/coords';
import { hasAnswerKey } from '../../grading/grade';

interface Props {
  question: Question;
  page: PageInfo;
  scale: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onChangeRect: (id: string, rect: NormRect, commit: boolean) => void;
  onChangeAnchors?: (id: string, anchors: NormPoint[]) => void;
  /** When this question's choice positions are being recorded: index of the next option to click. */
  anchoringIndex?: number | null;
}

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w';
const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se', 'e', 'w'];

const TYPE_CLASS: Record<Question['type'], string> = {
  'multiple-choice': 'mc',
  'short-answer': 'sa',
  manual: 'manual',
};

/**
 * A draggable/resizable overlay in the authoring workspace. All geometry is
 * computed in normalized page units; pixels are only used for the pointer delta.
 */
export function AuthorField({ question, page, scale, selected, onSelect, onChangeRect, onChangeAnchors, anchoringIndex }: Props) {
  const px = normToPx(question.rect, page, scale);
  const drag = useRef<{ startX: number; startY: number; rect: NormRect; handle: Handle | 'move' } | null>(null);
  const anchorDrag = useRef<{ index: number; startX: number; startY: number; anchors: NormPoint[] } | null>(null);
  const box: PageBox = { width: page.width * scale, height: page.height * scale };
  const anchoring = anchoringIndex !== null && anchoringIndex !== undefined;
  const mc = question.type === 'multiple-choice' ? question : null;
  const showAnchors = mc !== null && (anchoring || (mc.anchors?.length ?? 0) > 0);

  // Dragging one anchor marker (rect-relative coordinates, clamped to the box).
  const beginAnchor = (e: PointerEvent, index: number) => {
    if (e.button !== 0 || !mc?.anchors) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(question.id);
    anchorDrag.current = { index, startX: e.clientX, startY: e.clientY, anchors: mc.anchors };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveAnchor = (e: PointerEvent) => {
    const d = anchorDrag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / px.width;
    const dy = (e.clientY - d.startY) / px.height;
    const a = d.anchors[d.index];
    const next = d.anchors.slice();
    next[d.index] = { x: Math.min(1, Math.max(0, a.x + dx)), y: Math.min(1, Math.max(0, a.y + dy)) };
    onChangeAnchors?.(question.id, next);
  };
  const endAnchor = (e: PointerEvent) => {
    if (!anchorDrag.current) return;
    moveAnchor(e);
    anchorDrag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const begin = (e: PointerEvent, handle: Handle | 'move') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    // preventDefault keeps focus where it was (e.g. a sidebar input), which
    // would make keyboard shortcuts look like typing. Clicking a field should
    // behave like clicking anywhere else: take focus away from form controls.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) active.blur();
    onSelect(question.id);
    drag.current = { startX: e.clientX, startY: e.clientY, rect: question.rect, handle };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / box.width;
    const dy = (e.clientY - d.startY) / box.height;
    onChangeRect(question.id, applyDelta(d.rect, d.handle, dx, dy), false);
  };

  const end = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const dx = (e.clientX - d.startX) / box.width;
    const dy = (e.clientY - d.startY) / box.height;
    onChangeRect(question.id, applyDelta(d.rect, d.handle, dx, dy), true);
  };

  return (
    <div
      className={`ov author ${TYPE_CLASS[question.type]}${showAnchors ? ' anchored' : ''}${selected ? ' selected' : ''}${hasAnswerKey(question) ? '' : ' missing-key'}`}
      style={{ left: px.left, top: px.top, width: px.width, height: px.height }}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      title={`Question ${question.number} (${question.type})`}
    >
      <span className="ov-label">{question.number}</span>
      <span className="ov-preview">{preview(question)}</span>
      {mc &&
        showAnchors &&
        mc.options.map((opt, i) => {
          const a = mc.anchors?.[i];
          const pending = !a;
          const isNext = anchoring && i === anchoringIndex;
          // Pending markers (not yet clicked) are previewed along the box so the author sees what is left.
          const pos = a ?? { x: (i + 0.5) / mc.options.length, y: 0.5 };
          return (
            <div
              key={opt}
              className={`ov-anchor${pending ? ' pending' : ''}${isNext ? ' next' : ''}`}
              style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
              title={pending ? `${opt}: not placed yet` : `${opt} (drag to adjust)`}
              onPointerDown={pending ? undefined : (e) => beginAnchor(e, i)}
              onPointerMove={moveAnchor}
              onPointerUp={endAnchor}
              onPointerCancel={endAnchor}
            >
              {opt}
            </div>
          );
        })}
      {selected &&
        HANDLES.map((h) => (
          <div
            key={h}
            className={`handle ${h}`}
            onPointerDown={(e) => begin(e, h)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        ))}
    </div>
  );
}

function preview(q: Question): string {
  switch (q.type) {
    case 'multiple-choice':
      return q.options.join('  ');
    case 'short-answer':
      return q.accepted[0] ? `✓ ${q.accepted[0]}` : 'text';
    case 'manual':
      return 'manual grading';
  }
}

export function applyDelta(rect: NormRect, handle: Handle | 'move', dx: number, dy: number): NormRect {
  let { x, y, w, h } = rect;
  if (handle === 'move') {
    x += dx;
    y += dy;
  } else {
    if (handle.includes('e')) w += dx;
    if (handle.includes('w')) {
      x += dx;
      w -= dx;
    }
    if (handle.includes('s')) h += dy;
    if (handle.includes('n')) {
      y += dy;
      h -= dy;
    }
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
  }
  return clampNormRect({ x, y, w, h });
}
