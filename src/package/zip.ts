import JSZip from 'jszip';
import type { ExamManifest, StoredExam } from '../model/types';
import { sha256Hex } from './hash';
import { MANIFEST_FILE, PACKAGE_EXTENSION, PDF_FILE, validateManifest } from './format';

export class PackageError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'PackageError';
    this.details = details;
  }
}

export async function exportPackage(exam: StoredExam): Promise<Blob> {
  const zip = new JSZip();
  zip.file(MANIFEST_FILE, JSON.stringify(exam.manifest, null, 2));
  zip.file(PDF_FILE, await exam.pdfBlob.arrayBuffer());
  zip.file(
    'README.txt',
    [
      'PDF Exam Practice package',
      `Title: ${exam.manifest.title}`,
      `Format version: ${exam.manifest.formatVersion}`,
      '',
      'manifest.json holds the answer fields, answer key and settings.',
      'exam.pdf is the original document. Import this file with the app.',
    ].join('\n'),
  );
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' });
}

export interface ImportResult {
  exam: StoredExam;
  warnings: string[];
}

export async function importPackage(data: ArrayBuffer | Blob): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new PackageError('This file is not a valid exam package (not a ZIP archive).');
  }
  const manifestEntry = zip.file(MANIFEST_FILE);
  const pdfEntry = zip.file(PDF_FILE);
  if (!manifestEntry) throw new PackageError(`The package has no ${MANIFEST_FILE}.`);
  if (!pdfEntry) throw new PackageError(`The package has no ${PDF_FILE}.`);

  let raw: unknown;
  try {
    raw = JSON.parse(await manifestEntry.async('string'));
  } catch {
    throw new PackageError(`${MANIFEST_FILE} is not valid JSON.`);
  }
  const validation = validateManifest(raw);
  if (!validation.ok) throw new PackageError('The exam manifest is invalid.', validation.errors);

  const pdfBytes = new Uint8Array(await pdfEntry.async('arraybuffer'));
  const hash = await sha256Hex(pdfBytes);
  if (hash !== validation.manifest.pdf.sha256) {
    throw new PackageError('The PDF inside the package does not match the manifest (checksum mismatch).');
  }
  const warnings = [...validation.warnings];
  if (pdfBytes.byteLength !== validation.manifest.pdf.byteLength) {
    warnings.push('PDF byte length differs from the manifest.');
  }
  return {
    exam: { manifest: validation.manifest, pdfBlob: new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }) },
    warnings,
  };
}

export function packageFileName(manifest: ExamManifest): string {
  const safe = manifest.title.replace(/[^\p{L}\p{N}\- _]/gu, '').trim().replace(/\s+/g, '-') || 'exam';
  return `${safe}${PACKAGE_EXTENSION}`;
}
