/**
 * Versioned data model for exams, questions, and student attempts.
 *
 * Coordinates: every field position is a `NormRect` whose x/y/w/h are fractions
 * (0..1) of the page's *displayed* box, i.e. the PDF.js viewport at scale 1 with
 * the page's own /Rotate applied. This makes positions independent of zoom,
 * window size, and device pixel ratio. See `src/pdf/coords.ts`.
 */

export const PACKAGE_FORMAT_VERSION = 1 as const;

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in the same normalized space as NormRect, or relative to a rect (see MultipleChoiceQuestion.anchors). */
export interface NormPoint {
  x: number;
  y: number;
}

export interface PageInfo {
  /** 0-based page index. */
  index: number;
  /** Width of the displayed page in PDF points (after rotation). */
  width: number;
  /** Height of the displayed page in PDF points (after rotation). */
  height: number;
  /** Intrinsic page rotation in degrees (0, 90, 180, 270). */
  rotation: number;
}

export interface PdfAssetInfo {
  fileName: string;
  /** Hex SHA-256 of the PDF bytes; used to detect mismatched packages. */
  sha256: string;
  byteLength: number;
  pageCount: number;
  pages: PageInfo[];
}

export type QuestionType = 'multiple-choice' | 'short-answer' | 'manual';

export interface QuestionBase {
  /** Stable identifier; never derived from position or order. */
  id: string;
  /** Display label, e.g. "1", "12a", "Part III.4". */
  number: string;
  pageIndex: number;
  rect: NormRect;
  points: number;
  /** Optional explanation shown with results. */
  explanation?: string;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multiple-choice';
  options: string[];
  /** The single correct option (must be one of `options`). */
  correct: string;
  /** Fallback rendering when no anchors are set: a row/column of buttons filling `rect`. */
  layout: 'horizontal' | 'vertical';
  /**
   * Where each option's printed letter sits, one entry per option, as
   * fractions (0..1) of `rect` itself. Relative to the rect so that moving,
   * resizing, duplicating or pasting the field keeps them in place. When set,
   * the student clicks a marker over the printed letter instead of a button.
   */
  anchors?: NormPoint[];
}

export interface TextMatchingRules {
  caseInsensitive: boolean;
  trim: boolean;
  collapseWhitespace: boolean;
  ignorePunctuation: boolean;
  ignoreAccents: boolean;
}

export interface ShortAnswerQuestion extends QuestionBase {
  type: 'short-answer';
  /** Any of these counts as correct. */
  accepted: string[];
  matching: TextMatchingRules;
}

export interface ManualQuestion extends QuestionBase {
  type: 'manual';
  multiline: boolean;
  /** Shown to the examiner (and to the student after grading, if enabled). */
  modelAnswer?: string;
}

export type Question = MultipleChoiceQuestion | ShortAnswerQuestion | ManualQuestion;

export interface ExamSettings {
  /** Show correctness immediately while answering (reveals the key). */
  practiceMode: boolean;
  /** After submission, show the correct answer for wrong responses. */
  showCorrectAnswersAfterSubmit: boolean;
  /** Optional PIN required to open the authoring workspace. */
  authorPin?: string;
}

export interface ExamManifest {
  formatVersion: typeof PACKAGE_FORMAT_VERSION;
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  pdf: PdfAssetInfo;
  settings: ExamSettings;
  questions: Question[];
}

/** A stored exam = manifest + the original PDF bytes. */
export interface StoredExam {
  manifest: ExamManifest;
  pdfBlob: Blob;
}

export type AttemptStatus = 'in-progress' | 'submitted';

export interface QuestionResult {
  questionId: string;
  /** Response as submitted (may be empty). */
  response: string;
  maxPoints: number;
  /** Points from automatic grading, or null when manual grading is required. */
  autoPoints: number | null;
  /** Points assigned by the examiner for manual questions. */
  manualPoints: number | null;
  /** True if auto-graded and correct. Null for manual questions. */
  correct: boolean | null;
  needsManualGrading: boolean;
}

export interface GradeSummary {
  /** Points from automatic grading only (manual questions count as 0). */
  provisionalPoints: number;
  /** Provisional points + manual points awarded so far. */
  finalPoints: number;
  maxPoints: number;
  /** Based on finalPoints. */
  percentage: number;
  autoGradedCount: number;
  correctCount: number;
  incorrectCount: number;
  manualPendingCount: number;
  manualGradedCount: number;
  /** True when every manual question has been graded. */
  complete: boolean;
  results: QuestionResult[];
}

export interface Attempt {
  id: string;
  examId: string;
  status: AttemptStatus;
  startedAt: string;
  updatedAt: string;
  submittedAt?: string;
  /** questionId -> raw response string. */
  responses: Record<string, string>;
  /** questionId -> points assigned by the examiner (manual questions). */
  manualScores: Record<string, number>;
}
