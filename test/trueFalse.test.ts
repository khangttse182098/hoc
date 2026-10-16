import { describe, expect, it } from 'vitest';
import { createQuestion, setDefaultNotGiven } from '../src/model/defaults';
import { hasNotGiven, isTrueFalse, trueFalseOptions, withNotGiven } from '../src/model/trueFalse';
import { gradeQuestion, isAnswered } from '../src/grading/grade';
import { validateManifest } from '../src/package/format';
import { createManifest } from '../src/model/defaults';
import type { MultipleChoiceQuestion } from '../src/model/types';

const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.03 };

describe('true/false preset', () => {
  it('creates a multiple-choice question with T/F, remembering the Not Given default', () => {
    setDefaultNotGiven(false);
    const q = createQuestion('true-false', 0, rect, '1') as MultipleChoiceQuestion;
    expect(q.type).toBe('multiple-choice');
    expect(q.options).toEqual(['T', 'F']);
    expect(isTrueFalse(q)).toBe(true);
    expect(hasNotGiven(q)).toBe(false);
    setDefaultNotGiven(true);
    const q2 = createQuestion('true-false', 0, rect, '2') as MultipleChoiceQuestion;
    expect(q2.options).toEqual(['T', 'F', 'NG']);
    expect(hasNotGiven(q2)).toBe(true);
    setDefaultNotGiven(false);
  });

  it('recognises only the exact option sets', () => {
    const mc = createQuestion('multiple-choice', 0, rect, '1');
    expect(isTrueFalse(mc)).toBe(false);
    const q = createQuestion('true-false', 0, rect, '1') as MultipleChoiceQuestion;
    expect(isTrueFalse({ ...q, options: ['T', 'F', 'NG', 'X'] })).toBe(false);
    expect(isTrueFalse({ ...q, options: ['F', 'T'] })).toBe(false);
    expect(isTrueFalse(createQuestion('short-answer', 0, rect, '1'))).toBe(false);
    expect(trueFalseOptions(true)).toEqual(['T', 'F', 'NG']);
  });

  it('toggling Not Given keeps a still-valid key and drops anchors', () => {
    const q = { ...(createQuestion('true-false', 0, rect, '1') as MultipleChoiceQuestion), correct: 'F', anchors: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] };
    const withNg = withNotGiven(q, true);
    expect(withNg.options).toEqual(['T', 'F', 'NG']);
    expect(withNg.correct).toBe('F');
    expect(withNg.anchors).toBeUndefined();
    expect(withNotGiven(withNg, true)).toBe(withNg); // no-op keeps identity
    const ngKey = { ...withNg, correct: 'NG' };
    expect(withNotGiven(ngKey, false).correct).toBe('');
  });

  it('grades like any multiple-choice question', () => {
    const q = { ...(createQuestion('true-false', 0, rect, '1') as MultipleChoiceQuestion), options: ['T', 'F', 'NG'], correct: 'NG' };
    expect(gradeQuestion(q, 'NG', undefined).correct).toBe(true);
    expect(gradeQuestion(q, 'T', undefined).correct).toBe(false);
    expect(gradeQuestion(q, undefined, undefined).correct).toBe(false);
    expect(isAnswered(q, 'F')).toBe(true);
    expect(isAnswered(q, 'Not Given')).toBe(false);
  });

  it('round-trips through the package format unchanged', () => {
    const m = createManifest('t', { fileName: 'a.pdf', sha256: 'a'.repeat(64), byteLength: 1, pageCount: 1, pages: [{ index: 0, width: 595, height: 842 }] });
    m.questions.push({ ...(createQuestion('true-false', 0, rect, '1') as MultipleChoiceQuestion), options: ['T', 'F', 'NG'], correct: 'NG' });
    const parsed = validateManifest(JSON.parse(JSON.stringify(m)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manifest.questions[0]).toMatchObject({ type: 'multiple-choice', options: ['T', 'F', 'NG'], correct: 'NG' });
      expect(isTrueFalse(parsed.manifest.questions[0])).toBe(true);
    }
  });
});
