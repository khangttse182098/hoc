import type { Attempt, ExamManifest, GradeSummary, Question, QuestionResult } from '../model/types';
import { matchesAccepted } from './normalize';

/** Whether a (possibly partial) response counts as "answered" for progress. */
export function isAnswered(q: Question, response: string | undefined): boolean {
  if (response === undefined) return false;
  if (q.type === 'multiple-choice') return q.options.includes(response);
  return response.trim().length > 0;
}

export function gradeQuestion(q: Question, response: string | undefined, manualPoints: number | undefined): QuestionResult {
  const resp = response ?? '';
  const base = { questionId: q.id, response: resp, maxPoints: q.points };
  switch (q.type) {
    case 'multiple-choice': {
      const correct = resp !== '' && resp === q.correct;
      return { ...base, autoPoints: correct ? q.points : 0, manualPoints: null, correct, needsManualGrading: false };
    }
    case 'short-answer': {
      const correct = matchesAccepted(resp, q.accepted, q.matching);
      return { ...base, autoPoints: correct ? q.points : 0, manualPoints: null, correct, needsManualGrading: false };
    }
    case 'manual': {
      const mp = manualPoints === undefined ? null : clampPoints(manualPoints, q.points);
      return { ...base, autoPoints: null, manualPoints: mp, correct: null, needsManualGrading: true };
    }
  }
}

export function clampPoints(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), max);
}

export function gradeAttempt(manifest: ExamManifest, attempt: Pick<Attempt, 'responses' | 'manualScores'>): GradeSummary {
  const results = manifest.questions.map((q) =>
    gradeQuestion(q, attempt.responses[q.id], attempt.manualScores[q.id]),
  );
  const maxPoints = round(results.reduce((s, r) => s + r.maxPoints, 0));
  const provisionalPoints = round(results.reduce((s, r) => s + (r.autoPoints ?? 0), 0));
  const manualAwarded = round(results.reduce((s, r) => s + (r.manualPoints ?? 0), 0));
  const finalPoints = round(provisionalPoints + manualAwarded);
  const manualResults = results.filter((r) => r.needsManualGrading);
  const manualGradedCount = manualResults.filter((r) => r.manualPoints !== null).length;
  const autoResults = results.filter((r) => !r.needsManualGrading);
  return {
    provisionalPoints,
    finalPoints,
    maxPoints,
    percentage: maxPoints > 0 ? round((finalPoints / maxPoints) * 100, 1) : 0,
    autoGradedCount: autoResults.length,
    correctCount: autoResults.filter((r) => r.correct).length,
    incorrectCount: autoResults.filter((r) => !r.correct).length,
    manualPendingCount: manualResults.length - manualGradedCount,
    manualGradedCount,
    complete: manualGradedCount === manualResults.length,
    results,
  };
}

/** Human-readable correct answer for display in results. */
export function correctAnswerText(q: Question): string {
  switch (q.type) {
    case 'multiple-choice':
      return q.correct;
    case 'short-answer':
      return q.accepted.join(' / ');
    case 'manual':
      return q.modelAnswer ?? '';
  }
}

/** True if the author has entered an answer key for this question. */
export function hasAnswerKey(q: Question): boolean {
  switch (q.type) {
    case 'multiple-choice':
      return q.correct !== '' && q.options.includes(q.correct);
    case 'short-answer':
      return q.accepted.some((a) => a.trim() !== '');
    case 'manual':
      return true;
  }
}

function round(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
