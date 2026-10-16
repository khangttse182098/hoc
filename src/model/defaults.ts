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
  type: QuestionType,
  pageIndex: number,
  rect: NormRect,
  number: string,
): Question {
  const base = { id: newId('q'), number, pageIndex, rect, points: 1 };
  switch (type) {
    case 'multiple-choice':
      return { ...base, type, options: ['A', 'B', 'C', 'D'], correct: '', layout: 'horizontal' };
    case 'short-answer':
      return { ...base, type, accepted: [], matching: { ...DEFAULT_MATCHING } };
    case 'manual':
      return { ...base, type, multiline: true };
  }
}

/** Default overlay size (as a fraction of page width/height) per question type. */
export function defaultRectFor(type: QuestionType, pageAspect: number): { w: number; h: number } {
  // pageAspect = width / height; heights are expressed in page-height units.
  const lineH = 0.022 * (0.707 / pageAspect); // ~ one text line on A4
  switch (type) {
    case 'multiple-choice':
      return { w: 0.28, h: lineH * 1.3 };
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
