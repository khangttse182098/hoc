import type { MultipleChoiceQuestion, Question } from './types';

/**
 * True / False / Not Given questions are multiple-choice questions with a
 * fixed option set, so grading, anchors, packages and the student UI all
 * reuse the multiple-choice code. Options are stored as the short codes the
 * student would write on paper ("T", "F", "NG").
 */
export const TRUE = 'T';
export const FALSE = 'F';
export const NOT_GIVEN = 'NG';

/** Full words shown as tooltips next to the short codes. */
export const OPTION_WORD: Record<string, string> = { [TRUE]: 'True', [FALSE]: 'False', [NOT_GIVEN]: 'Not Given' };

export function trueFalseOptions(notGiven: boolean): string[] {
  return notGiven ? [TRUE, FALSE, NOT_GIVEN] : [TRUE, FALSE];
}

export function isTrueFalse(q: Question): boolean {
  if (q.type !== 'multiple-choice') return false;
  const [a, b, c, ...rest] = q.options;
  return a === TRUE && b === FALSE && (c === undefined || c === NOT_GIVEN) && rest.length === 0;
}

export function hasNotGiven(q: Question): boolean {
  return q.type === 'multiple-choice' && isTrueFalse(q) && q.options.includes(NOT_GIVEN);
}

/** Add or remove the "Not Given" option, keeping the key only if it still exists. */
export function withNotGiven(q: MultipleChoiceQuestion, notGiven: boolean): MultipleChoiceQuestion {
  const options = trueFalseOptions(notGiven);
  if (options.length === q.options.length) return q;
  return {
    ...q,
    options,
    correct: options.includes(q.correct) ? q.correct : '',
    // Anchors are one-per-option; a different count means they no longer line up.
    anchors: undefined,
  };
}
