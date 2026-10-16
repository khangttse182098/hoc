/**
 * Exam package format.
 *
 * A package is a ZIP file (extension `.exam.zip`) containing:
 *   manifest.json   - ExamManifest (formatVersion = 1)
 *   exam.pdf        - the original PDF, byte-for-byte
 *
 * The manifest's `pdf.sha256` must match the SHA-256 of exam.pdf. Packages
 * written by a newer `formatVersion` are rejected with a clear message; older
 * versions are migrated by `migrateManifest` (none exist yet).
 */
import type {
  ExamManifest,
  ExamSettings,
  NormPoint,
  NormRect,
  PageInfo,
  Question,
  TextMatchingRules,
} from '../model/types';
import { PACKAGE_FORMAT_VERSION } from '../model/types';
import { isInsidePage } from '../pdf/coords';

export const MANIFEST_FILE = 'manifest.json';
export const PDF_FILE = 'exam.pdf';
export const PACKAGE_EXTENSION = '.exam.zip';

export type ValidationResult =
  | { ok: true; manifest: ExamManifest; warnings: string[] }
  | { ok: false; errors: string[] };

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Validate an untrusted manifest object and return a typed copy. */
export function validateManifest(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['Manifest is not a JSON object.'] };

  const version = raw.formatVersion;
  if (!isNum(version)) return { ok: false, errors: ['Manifest has no formatVersion.'] };
  if (version > PACKAGE_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `This package uses format version ${version}, but this app only supports up to version ${PACKAGE_FORMAT_VERSION}. Update the app to open it.`,
      ],
    };
  }
  const m = migrateManifest(raw, version);

  if (!isStr(m.id) || m.id.trim() === '') errors.push('Missing exam id.');
  if (!isStr(m.title)) errors.push('Missing exam title.');
  const description = isStr(m.description) ? m.description : '';
  const createdAt = isStr(m.createdAt) ? m.createdAt : new Date().toISOString();
  const updatedAt = isStr(m.updatedAt) ? m.updatedAt : createdAt;

  // PDF info
  const pdf = m.pdf;
  let pages: PageInfo[] = [];
  if (!isObj(pdf)) errors.push('Missing pdf section.');
  else {
    if (!isStr(pdf.fileName)) errors.push('pdf.fileName must be a string.');
    if (!isStr(pdf.sha256) || !/^[0-9a-f]{64}$/.test(pdf.sha256)) errors.push('pdf.sha256 must be a hex SHA-256.');
    if (!isNum(pdf.byteLength)) errors.push('pdf.byteLength must be a number.');
    if (!isNum(pdf.pageCount) || pdf.pageCount < 1) errors.push('pdf.pageCount must be a positive number.');
    if (!Array.isArray(pdf.pages)) errors.push('pdf.pages must be an array.');
    else {
      pages = [];
      pdf.pages.forEach((p, i) => {
        if (!isObj(p) || !isNum(p.width) || !isNum(p.height) || p.width <= 0 || p.height <= 0) {
          errors.push(`pdf.pages[${i}] has invalid dimensions.`);
          return;
        }
        pages.push({
          index: isNum(p.index) ? p.index : i,
          width: p.width,
          height: p.height,
          rotation: isNum(p.rotation) ? p.rotation : 0,
        });
      });
      if (isNum(pdf.pageCount) && pages.length !== pdf.pageCount) {
        errors.push(`pdf.pages has ${pages.length} entries but pageCount is ${pdf.pageCount}.`);
      }
    }
  }

  // Settings
  const settings: ExamSettings = {
    practiceMode: false,
    showCorrectAnswersAfterSubmit: true,
  };
  if (isObj(m.settings)) {
    if (isBool(m.settings.practiceMode)) settings.practiceMode = m.settings.practiceMode;
    if (isBool(m.settings.showCorrectAnswersAfterSubmit))
      settings.showCorrectAnswersAfterSubmit = m.settings.showCorrectAnswersAfterSubmit;
    if (isStr(m.settings.authorPin) && m.settings.authorPin !== '') settings.authorPin = m.settings.authorPin;
  }

  // Questions
  const questions: Question[] = [];
  const seenIds = new Set<string>();
  if (!Array.isArray(m.questions)) errors.push('questions must be an array.');
  else {
    m.questions.forEach((q, i) => {
      const r = validateQuestion(q, i, pages.length);
      if (!r.ok) {
        errors.push(...r.errors);
        return;
      }
      if (seenIds.has(r.question.id)) {
        errors.push(`questions[${i}]: duplicate id "${r.question.id}".`);
        return;
      }
      seenIds.add(r.question.id);
      warnings.push(...r.warnings);
      questions.push(r.question);
    });
  }

  if (errors.length) return { ok: false, errors };
  const p = pdf as Raw;
  const manifest: ExamManifest = {
    formatVersion: PACKAGE_FORMAT_VERSION,
    id: m.id as string,
    title: m.title as string,
    description,
    createdAt,
    updatedAt,
    pdf: {
      fileName: p.fileName as string,
      sha256: p.sha256 as string,
      byteLength: p.byteLength as number,
      pageCount: p.pageCount as number,
      pages,
    },
    settings,
    questions,
  };
  return { ok: true, manifest, warnings };
}

function validateRect(v: unknown): NormRect | null {
  if (!isObj(v)) return null;
  const { x, y, w, h } = v;
  if (!isNum(x) || !isNum(y) || !isNum(w) || !isNum(h)) return null;
  return { x, y, w, h };
}

function validateMatching(v: unknown): TextMatchingRules {
  const o = isObj(v) ? v : {};
  return {
    caseInsensitive: isBool(o.caseInsensitive) ? o.caseInsensitive : true,
    trim: isBool(o.trim) ? o.trim : true,
    collapseWhitespace: isBool(o.collapseWhitespace) ? o.collapseWhitespace : true,
    ignorePunctuation: isBool(o.ignorePunctuation) ? o.ignorePunctuation : false,
    ignoreAccents: isBool(o.ignoreAccents) ? o.ignoreAccents : false,
  };
}

/** One {x, y} in 0..1 per option, or null when malformed. */
function validateAnchors(raw: unknown, optionCount: number): NormPoint[] | null {
  if (!Array.isArray(raw) || raw.length !== optionCount) return null;
  const out: NormPoint[] = [];
  for (const a of raw) {
    if (!isObj(a) || !isNum(a.x) || !isNum(a.y) || a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1) return null;
    out.push({ x: a.x, y: a.y });
  }
  return out;
}

type QuestionValidation =
  | { ok: true; question: Question; warnings: string[] }
  | { ok: false; errors: string[] };

export function validateQuestion(raw: unknown, i: number, pageCount: number): QuestionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = `questions[${i}]`;
  if (!isObj(raw)) return { ok: false, errors: [`${label} is not an object.`] };
  if (!isStr(raw.id) || raw.id === '') errors.push(`${label}: missing id.`);
  const number = isStr(raw.number) ? raw.number : String(i + 1);
  if (!isNum(raw.pageIndex) || raw.pageIndex < 0 || !Number.isInteger(raw.pageIndex)) {
    errors.push(`${label}: invalid pageIndex.`);
  } else if (pageCount > 0 && raw.pageIndex >= pageCount) {
    errors.push(`${label}: pageIndex ${raw.pageIndex} is outside the document (${pageCount} pages).`);
  }
  const rect = validateRect(raw.rect);
  if (!rect) errors.push(`${label}: invalid rect.`);
  else if (!isInsidePage(rect)) errors.push(`${label}: rect lies outside the page.`);
  if (!isNum(raw.points) || raw.points < 0) errors.push(`${label}: points must be a non-negative number.`);
  const explanation = isStr(raw.explanation) && raw.explanation !== '' ? raw.explanation : undefined;
  if (errors.length) return { ok: false, errors };

  const base = {
    id: raw.id as string,
    number,
    pageIndex: raw.pageIndex as number,
    rect: rect as NormRect,
    points: raw.points as number,
    ...(explanation ? { explanation } : {}),
  };

  switch (raw.type) {
    case 'multiple-choice': {
      if (!isStrArr(raw.options) || raw.options.length < 2) {
        return { ok: false, errors: [`${label}: multiple-choice needs at least two options.`] };
      }
      const correct = isStr(raw.correct) ? raw.correct : '';
      if (correct !== '' && !raw.options.includes(correct)) {
        return { ok: false, errors: [`${label}: correct answer "${correct}" is not one of the options.`] };
      }
      if (correct === '') warnings.push(`Question ${number} has no correct answer set.`);
      const layout = raw.layout === 'vertical' ? 'vertical' : 'horizontal';
      const q: Question = { ...base, type: 'multiple-choice', options: raw.options, correct, layout };
      if (raw.anchors !== undefined) {
        const anchors = validateAnchors(raw.anchors, raw.options.length);
        if (anchors) q.anchors = anchors;
        else warnings.push(`Question ${number}: choice positions were invalid and have been cleared.`);
      }
      return { ok: true, warnings, question: q };
    }
    case 'short-answer': {
      const accepted = isStrArr(raw.accepted) ? raw.accepted : [];
      if (accepted.length === 0) warnings.push(`Question ${number} has no accepted answers.`);
      return {
        ok: true,
        warnings,
        question: { ...base, type: 'short-answer', accepted, matching: validateMatching(raw.matching) },
      };
    }
    case 'manual': {
      const modelAnswer = isStr(raw.modelAnswer) && raw.modelAnswer !== '' ? raw.modelAnswer : undefined;
      return {
        ok: true,
        warnings,
        question: {
          ...base,
          type: 'manual',
          multiline: isBool(raw.multiline) ? raw.multiline : true,
          ...(modelAnswer ? { modelAnswer } : {}),
        },
      };
    }
    default:
      return { ok: false, errors: [`${label}: unknown question type "${String(raw.type)}".`] };
  }
}

/** Upgrade older manifests in place. Currently only version 1 exists. */
export function migrateManifest(raw: Raw, fromVersion: number): Raw {
  if (fromVersion === PACKAGE_FORMAT_VERSION) return raw;
  // Future: if (fromVersion === 1) { ...convert to 2... }
  return raw;
}

/** Strip the answer key so the student mode never sees grading configuration. */
export function stripAnswerKey(manifest: ExamManifest): ExamManifest {
  return {
    ...manifest,
    settings: { ...manifest.settings, authorPin: undefined },
    questions: manifest.questions.map((q): Question => {
      switch (q.type) {
        case 'multiple-choice':
          return { ...q, correct: '' };
        case 'short-answer':
          return { ...q, accepted: [] };
        case 'manual':
          return { ...q, modelAnswer: undefined };
      }
    }),
  };
}
