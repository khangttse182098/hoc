import { useLayoutEffect, useRef, useState } from 'react';
import type { PageInfo, Question, QuestionResult } from '../../model/types';
import { hasAnchors } from '../../model/anchors';
import { normToPx } from '../../pdf/coords';

export interface FieldFeedback {
  result: QuestionResult;
  /** Correct answer to reveal (undefined = do not reveal). */
  reveal?: string;
}

interface Props {
  question: Question;
  page: PageInfo;
  scale: number;
  value: string;
  onChange?: (id: string, value: string) => void;
  readOnly: boolean;
  feedback?: FieldFeedback;
  /** Commit text on blur (used for practice-mode feedback). */
  onCommit?: (id: string) => void;
}

const TYPE_CLASS: Record<Question['type'], string> = { 'multiple-choice': 'mc', 'short-answer': 'sa', manual: 'manual' };

/** Horizontal padding + caret room added to the measured text width of a single-line input. */
const TEXT_SLACK_PX = 18;
/** Smallest font a single-line answer may shrink to, relative to the normal field font. */
const MIN_FONT_RATIO = 0.7;

let measureCtx: CanvasRenderingContext2D | null = null;
function measureText(text: string, font: string): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** The interactive overlay a student sees: MC buttons, a text input, or a textarea. */
export function StudentField({ question: q, page, scale, value, onChange, readOnly, feedback, onCommit }: Props) {
  const authored = normToPx(q.rect, page, scale);
  const inputRef = useRef<HTMLInputElement>(null);
  // Text width at the normal font and at the smallest allowed font.
  const [textWidth, setTextWidth] = useState({ base: 0, floor: 0 });
  const [focused, setFocused] = useState(false);
  const singleLine = q.type === 'short-answer' || (q.type === 'manual' && !q.multiline);
  const baseFontSize = Math.max(9, Math.min(20, 11 * scale));

  // Measure the typed text at the normal field font (not the possibly shrunken
  // one) so the layout below is a pure function of value + scale.
  useLayoutEffect(() => {
    if (!singleLine || !inputRef.current) return;
    const family = getComputedStyle(inputRef.current).fontFamily;
    setTextWidth(
      value
        ? { base: measureText(value, `${baseFontSize}px ${family}`), floor: measureText(value, `${baseFontSize * MIN_FONT_RATIO}px ${family}`) }
        : { base: 0, floor: 0 },
    );
  }, [value, baseFontSize, singleLine]);

  // Fitting a long answer into a narrow gap, in order:
  //  1. shrink the font, down to MIN_FONT_RATIO, so the authored box never has
  //     to cover anything else;
  //  2. only while the field is focused, widen the box (never narrower than
  //     authored, never wider than the page, sliding left at the right edge);
  //  3. otherwise keep the authored box and show the full text as a tooltip.
  const pageWidth = page.width * scale;
  const available = Math.max(1, authored.width - TEXT_SLACK_PX);
  const fitRatio = singleLine && textWidth.base > available ? available / textWidth.base : 1;
  const fontSize = baseFontSize * Math.max(MIN_FONT_RATIO, fitRatio);
  const needed = fitRatio < MIN_FONT_RATIO ? Math.ceil(textWidth.floor + TEXT_SLACK_PX) : 0;
  let px = authored;
  if (focused && needed > authored.width) {
    const width = Math.min(needed, pageWidth);
    const left = Math.max(0, Math.min(authored.left, pageWidth - width));
    px = { ...authored, left, width };
  }
  const grown = px !== authored;
  const clipped = !grown && needed > authored.width;
  const r = feedback?.result;
  const resultClass = r ? (r.needsManualGrading ? ' result-manual' : r.correct ? ' result-correct' : ' result-wrong') : '';
  const disabled = readOnly || !onChange;
  const anchored = q.type === 'multiple-choice' && hasAnchors(q);
  // Marker size follows the zoom level so it sits over one printed letter.
  const spot = Math.max(16, Math.min(44, 20 * scale));

  const optionClass = (opt: string, base: string) => {
    let cls = base;
    if (value === opt) cls += r && !r.needsManualGrading ? (r.correct ? ' correct' : ' wrong') : ' chosen';
    else if (feedback?.reveal === opt) cls += ' correct';
    return cls;
  };

  return (
    <div
      className={`ov ${TYPE_CLASS[q.type]}${anchored ? ' anchored' : ''}${grown ? ' grown' : ''}${clipped ? ' clipped' : ''}${resultClass}`}
      style={{ left: px.left, top: px.top, width: px.width, height: px.height, fontSize }}
      data-question-id={q.id}
    >
      <span className="ov-label">{q.number}</span>
      {q.type === 'multiple-choice' && anchored ? (
        q.options.map((opt, i) => {
          const a = q.anchors[i];
          const cls = optionClass(opt, 'ov-mc-spot');
          const marked = cls !== 'ov-mc-spot';
          return (
            <button
              key={opt}
              type="button"
              className={cls}
              style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: spot, height: spot }}
              disabled={disabled}
              onClick={() => onChange?.(q.id, value === opt ? '' : opt)}
              aria-pressed={value === opt}
              aria-label={`Question ${q.number} option ${opt}`}
              title={opt}
            >
              {marked ? opt : ''}
            </button>
          );
        })
      ) : q.type === 'multiple-choice' ? (
        <div className={`ov-mc-options${q.layout === 'vertical' ? ' vertical' : ''}`}>
          {q.options.map((opt) => {
            return (
              <button
                key={opt}
                type="button"
                className={optionClass(opt, 'ov-mc-option')}
                disabled={disabled}
                onClick={() => onChange?.(q.id, value === opt ? '' : opt)}
                aria-pressed={value === opt}
                aria-label={`Question ${q.number} option ${opt}`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : q.type === 'manual' && q.multiline ? (
        <textarea
          className="ov-text multi"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(q.id, e.target.value)}
          onBlur={() => onCommit?.(q.id)}
          aria-label={`Question ${q.number} answer`}
          spellCheck={false}
        />
      ) : (
        <input
          ref={inputRef}
          className="ov-text"
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange?.(q.id, e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onCommit?.(q.id);
          }}
          aria-label={`Question ${q.number} answer`}
          title={clipped ? value : undefined}
          spellCheck={false}
          autoComplete="off"
          placeholder={feedback?.reveal && !value ? '' : undefined}
        />
      )}
      {r && (
        <span className={`ov-result-badge ${r.needsManualGrading ? 'manual' : r.correct ? 'ok' : 'bad'}`}>
          {r.needsManualGrading ? (r.manualPoints === null ? 'manual' : `${r.manualPoints}/${r.maxPoints}`) : r.correct ? '✓' : feedback?.reveal ? `✗ ${feedback.reveal}` : '✗'}
        </span>
      )}
    </div>
  );
}
