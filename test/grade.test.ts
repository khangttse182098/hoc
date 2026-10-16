import { describe, expect, it } from 'vitest';
import { clampPoints, gradeAttempt, gradeQuestion, hasAnswerKey, isAnswered } from '../src/grading/grade';
import { createManifest, DEFAULT_MATCHING } from '../src/model/defaults';
import type { ExamManifest, Question } from '../src/model/types';

const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 };
const mc: Question = { id: 'q1', number: '1', pageIndex: 0, rect, points: 2, type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correct: 'B', layout: 'horizontal' };
const sa: Question = { id: 'q2', number: '2', pageIndex: 0, rect, points: 1, type: 'short-answer', accepted: ['went', 'had gone'], matching: DEFAULT_MATCHING };
const manual: Question = { id: 'q3', number: '3', pageIndex: 0, rect, points: 3, type: 'manual', multiline: true };

function manifest(questions: Question[]): ExamManifest {
  const m = createManifest('Test', { fileName: 'x.pdf', sha256: 'a'.repeat(64), byteLength: 1, pageCount: 1, pages: [{ index: 0, width: 595, height: 842, rotation: 0 }] });
  return { ...m, questions };
}

describe('gradeQuestion', () => {
  it('grades multiple choice deterministically', () => {
    expect(gradeQuestion(mc, 'B', undefined)).toMatchObject({ correct: true, autoPoints: 2, needsManualGrading: false });
    expect(gradeQuestion(mc, 'A', undefined)).toMatchObject({ correct: false, autoPoints: 0 });
    expect(gradeQuestion(mc, undefined, undefined)).toMatchObject({ correct: false, autoPoints: 0, response: '' });
    expect(gradeQuestion(mc, 'b', undefined).correct).toBe(false); // options are exact
  });

  it('grades short answers through the matching rules', () => {
    expect(gradeQuestion(sa, ' Had  Gone ', undefined).correct).toBe(true);
    expect(gradeQuestion(sa, 'gone', undefined).correct).toBe(false);
  });

  it('never auto-grades manual questions', () => {
    expect(gradeQuestion(manual, 'essay', undefined)).toMatchObject({ autoPoints: null, manualPoints: null, correct: null, needsManualGrading: true });
    expect(gradeQuestion(manual, 'essay', 2.5).manualPoints).toBe(2.5);
    expect(gradeQuestion(manual, 'essay', 99).manualPoints).toBe(3); // clamped to max
    expect(gradeQuestion(manual, 'essay', -1).manualPoints).toBe(0);
  });
});

describe('gradeAttempt', () => {
  const m = manifest([mc, sa, manual]);

  it('reports provisional and final scores separately while manual grading is pending', () => {
    const s = gradeAttempt(m, { responses: { q1: 'B', q2: 'went', q3: 'essay' }, manualScores: {} });
    expect(s.maxPoints).toBe(6);
    expect(s.provisionalPoints).toBe(3);
    expect(s.finalPoints).toBe(3);
    expect(s.percentage).toBe(50);
    expect(s.correctCount).toBe(2);
    expect(s.incorrectCount).toBe(0);
    expect(s.manualPendingCount).toBe(1);
    expect(s.complete).toBe(false);
  });

  it('includes manual points once graded', () => {
    const s = gradeAttempt(m, { responses: { q1: 'A', q2: 'went', q3: 'essay' }, manualScores: { q3: 2 } });
    expect(s.provisionalPoints).toBe(1);
    expect(s.finalPoints).toBe(3);
    expect(s.percentage).toBe(50);
    expect(s.incorrectCount).toBe(1);
    expect(s.complete).toBe(true);
    expect(s.results.map((r) => r.questionId)).toEqual(['q1', 'q2', 'q3']);
  });

  it('handles an exam with no questions', () => {
    const s = gradeAttempt(manifest([]), { responses: {}, manualScores: {} });
    expect(s.maxPoints).toBe(0);
    expect(s.percentage).toBe(0);
    expect(s.complete).toBe(true);
  });

  it('avoids floating point drift in totals', () => {
    const qs: Question[] = Array.from({ length: 10 }, (_, i) => ({ ...sa, id: `s${i}`, points: 0.1 }));
    const s = gradeAttempt(manifest(qs), { responses: Object.fromEntries(qs.map((q) => [q.id, 'went'])), manualScores: {} });
    expect(s.finalPoints).toBe(1);
    expect(s.percentage).toBe(100);
  });
});

describe('helpers', () => {
  it('isAnswered', () => {
    expect(isAnswered(mc, 'A')).toBe(true);
    expect(isAnswered(mc, 'Z')).toBe(false);
    expect(isAnswered(sa, '  ')).toBe(false);
    expect(isAnswered(sa, 'x')).toBe(true);
    expect(isAnswered(manual, undefined)).toBe(false);
  });
  it('hasAnswerKey', () => {
    expect(hasAnswerKey(mc)).toBe(true);
    expect(hasAnswerKey({ ...mc, correct: '' })).toBe(false);
    expect(hasAnswerKey({ ...mc, correct: 'Z' })).toBe(false);
    expect(hasAnswerKey({ ...sa, accepted: [' '] })).toBe(false);
    expect(hasAnswerKey(manual)).toBe(true);
  });
  it('clampPoints', () => {
    expect(clampPoints(Number.NaN, 3)).toBe(0);
    expect(clampPoints(5, 3)).toBe(3);
  });
});
