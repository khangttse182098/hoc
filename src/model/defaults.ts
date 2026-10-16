import type {
  ExamManifest,
  ExamSettings,
  NormRect,
  PdfAssetInfo,
  Question,
  QuestionType,
  TextMatchingRules,
} from './types';
import { PACKAGE_FORMAT_VERSION } from './types';
import { newId } from './ids';
import { trueFalseOptions } from './trueFalse';

/**
 * What the author can add from the toolbar: the question types plus the
 * True/False preset, which produces a multiple-choice question.
 */
export type AuthorTool = QuestionType | 'true-false';

/** Whether new True/False fields include "Not Given"; remembers the author's last choice. */
let defaultNotGiven = false;
export function setDefaultNotGiven(v: boolean) {
  defaultNotGiven = v;
}
export function getDefaultNotGiven() {
  return defaultNotGiven;
}

export const DEFAULT_MATCHING: TextMatchingRules = {
  caseInsensitive: true,
  trim: true,
  collapseWhitespace: true,
  ignorePunctuation: false,
  ignoreAccents: false,
};

export const DEFAULT_SETTINGS: ExamSettings = {
  practiceMode: false,
  showCorrectAnswersAfterSubmit: true,
};

export function createManifest(title: string, pdf: PdfAssetInfo): ExamManifest {
  const now = new Date().toISOString();
  return {
    formatVersion: PACKAGE_FORMAT_VERSION,
    id: newId('exam'),
    title,
    description: '',
    createdAt: now,
    updatedAt: now,
    pdf,
    settings: { ...DEFAULT_SETTINGS },
    questions: [],
  };
}

export function createQuestion(
  type: AuthorTool,
  pageIndex: number,
  rect: NormRect,
  number: string,
): Question {
  const base = { id: newId('q'), number, pageIndex, rect, points: 1 };
  switch (type) {
    case 'multiple-choice':
      return { ...base, type, options: ['A', 'B', 'C', 'D'], correct: '', layout: 'horizontal' };
    case 'true-false':
      return { ...base, type: 'multiple-choice', options: trueFalseOptions(defaultNotGiven), correct: '', layout: 'horizontal' };
    case 'short-answer':
      return { ...base, type, accepted: [], matching: { ...DEFAULT_MATCHING } };
    case 'manual':
      return { ...base, type, multiline: true };
  }
}

/** Default overlay size (as a fraction of page width/height) per question type. */
export function defaultRectFor(type: AuthorTool, pageAspect: number): { w: number; h: number } {
  // pageAspect = width / height; heights are expressed in page-height units.
  const lineH = 0.022 * (0.707 / pageAspect); // ~ one text line on A4
  switch (type) {
    case 'multiple-choice':
      return { w: 0.28, h: lineH * 1.3 };
    case 'true-false':
      return { w: 0.16, h: lineH * 1.3 };
    case 'short-answer':
      return { w: 0.25, h: lineH * 1.2 };
    case 'manual':
      return { w: 0.6, h: lineH * 5 };
  }
}

export function nextQuestionNumber(questions: Question[]): string {
  let max = 0;
  for (const q of questions) {
    const n = parseInt(q.number, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}
