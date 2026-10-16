/**
 * Browser-local persistence using IndexedDB (via the tiny `idb` wrapper).
 *
 * Stores:
 *  - exams:    { id, manifest, pdfBlob }      keyed by exam id
 *  - attempts: Attempt                         keyed by attempt id, indexed by examId
 *
 * Nothing here talks to the network. Exported packages (see src/package) are
 * the portable backup; IndexedDB can be cleared by the browser.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Attempt, ExamManifest, StoredExam } from '../model/types';

interface ExamRecord {
  id: string;
  manifest: ExamManifest;
  pdfBlob: Blob;
}

interface Schema extends DBSchema {
  exams: { key: string; value: ExamRecord; indexes: { byUpdatedAt: string } };
  attempts: { key: string; value: Attempt; indexes: { byExamId: string } };
}

const DB_NAME = 'pdf-exam-practice';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const exams = database.createObjectStore('exams', { keyPath: 'id' });
        exams.createIndex('byUpdatedAt', 'manifest.updatedAt');
        const attempts = database.createObjectStore('attempts', { keyPath: 'id' });
        attempts.createIndex('byExamId', 'examId');
      },
    });
  }
  return dbPromise;
}

export interface ExamSummary {
  id: string;
  title: string;
  description: string;
  pageCount: number;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
  hasAuthorPin: boolean;
}

export function summarize(manifest: ExamManifest): ExamSummary {
  return {
    id: manifest.id,
    title: manifest.title,
    description: manifest.description,
    pageCount: manifest.pdf.pageCount,
    questionCount: manifest.questions.length,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    hasAuthorPin: Boolean(manifest.settings.authorPin),
  };
}

export async function listExams(): Promise<ExamSummary[]> {
  const all = await (await db()).getAll('exams');
  return all
    .map((r) => summarize(r.manifest))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getExam(id: string): Promise<StoredExam | undefined> {
  const r = await (await db()).get('exams', id);
  return r ? { manifest: r.manifest, pdfBlob: r.pdfBlob } : undefined;
}

export async function examExists(id: string): Promise<boolean> {
  return (await (await db()).getKey('exams', id)) !== undefined;
}

export async function saveExam(exam: StoredExam): Promise<void> {
  await (await db()).put('exams', { id: exam.manifest.id, manifest: exam.manifest, pdfBlob: exam.pdfBlob });
}

/** Deletes the exam and every attempt made on it. */
export async function deleteExam(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['exams', 'attempts'], 'readwrite');
  await tx.objectStore('exams').delete(id);
  const idx = tx.objectStore('attempts').index('byExamId');
  for (const key of await idx.getAllKeys(id)) await tx.objectStore('attempts').delete(key);
  await tx.done;
}

export async function listAttempts(examId: string): Promise<Attempt[]> {
  const all = await (await db()).getAllFromIndex('attempts', 'byExamId', examId);
  return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getAttempt(id: string): Promise<Attempt | undefined> {
  return (await db()).get('attempts', id);
}

export async function saveAttempt(attempt: Attempt): Promise<void> {
  await (await db()).put('attempts', attempt);
}

export async function deleteAttempt(id: string): Promise<void> {
  await (await db()).delete('attempts', id);
}

export async function clearAttempts(examId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('attempts', 'readwrite');
  for (const key of await tx.store.index('byExamId').getAllKeys(examId)) await tx.store.delete(key);
  await tx.done;
}
