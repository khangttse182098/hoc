import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createManifest, DEFAULT_MATCHING } from '../src/model/defaults';
import { PACKAGE_FORMAT_VERSION, type ExamManifest, type Question } from '../src/model/types';
import { stripAnswerKey, validateManifest } from '../src/package/format';
import { sha256Hex } from '../src/package/hash';
import { exportPackage, importPackage, PackageError, packageFileName } from '../src/package/zip';

const fakePdf = new TextEncoder().encode('%PDF-1.4 not really a pdf but good enough for packaging');

async function sampleManifest(): Promise<ExamManifest> {
  const m = createManifest('Đề thi HSG lớp 9', {
    fileName: 'de-thi.pdf',
    sha256: await sha256Hex(fakePdf),
    byteLength: fakePdf.byteLength,
    pageCount: 2,
    pages: [
      { index: 0, width: 595.28, height: 841.89, rotation: 0 },
      { index: 1, width: 841.89, height: 595.28, rotation: 90 },
    ],
  });
  const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 };
  const questions: Question[] = [
    { id: 'q1', number: '1', pageIndex: 0, rect, points: 1, type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correct: 'C', layout: 'horizontal' },
    { id: 'q2', number: '2', pageIndex: 1, rect, points: 0.5, type: 'short-answer', accepted: ['went'], matching: DEFAULT_MATCHING, explanation: 'past simple' },
    { id: 'q3', number: '3', pageIndex: 1, rect, points: 3, type: 'manual', multiline: true, modelAnswer: 'Any reasonable essay.' },
  ];
  return { ...m, questions, settings: { ...m.settings, authorPin: '1234' } };
}

describe('validateManifest', () => {
  it('accepts a well-formed manifest and returns a typed copy', async () => {
    const m = await sampleManifest();
    const r = validateManifest(JSON.parse(JSON.stringify(m)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest).toEqual(m);
      expect(r.warnings).toEqual([]);
    }
  });

  it('rejects non-objects and missing version', () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest('x').ok).toBe(false);
    expect(validateManifest({}).ok).toBe(false);
  });

  it('rejects packages from a newer format version with a clear message', async () => {
    const m = { ...(await sampleManifest()), formatVersion: PACKAGE_FORMAT_VERSION + 1 };
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/newer|only supports/i);
  });

  it('rejects questions outside the document or page', async () => {
    const m = await sampleManifest();
    const bad = { ...m, questions: [{ ...m.questions[0], pageIndex: 5 }, { ...m.questions[1], rect: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } }] };
    const r = validateManifest(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('outside the document'))).toBe(true);
      expect(r.errors.some((e) => e.includes('outside the page'))).toBe(true);
    }
  });

  it('rejects duplicate ids, unknown types and inconsistent MC keys', async () => {
    const m = await sampleManifest();
    const dup = validateManifest({ ...m, questions: [m.questions[0], m.questions[0]] });
    expect(dup.ok).toBe(false);
    const unknown = validateManifest({ ...m, questions: [{ ...m.questions[0], type: 'essay' }] });
    expect(unknown.ok).toBe(false);
    const badKey = validateManifest({ ...m, questions: [{ ...m.questions[0], correct: 'Z' }] });
    expect(badKey.ok).toBe(false);
  });

  it('warns (not fails) about missing answer keys and fills defaults', async () => {
    const m = await sampleManifest();
    const r = validateManifest({
      ...m,
      settings: undefined,
      questions: [
        { ...m.questions[0], correct: '' },
        { id: 'x', number: '9', pageIndex: 0, rect: m.questions[0].rect, points: 1, type: 'short-answer' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.length).toBe(2);
      expect(r.manifest.settings).toEqual({ practiceMode: false, showCorrectAnswersAfterSubmit: true });
      const sa = r.manifest.questions[1];
      expect(sa.type === 'short-answer' && sa.matching).toEqual(DEFAULT_MATCHING);
    }
  });

  it('keeps valid multiple-choice anchors and clears malformed ones with a warning', async () => {
    const m = await sampleManifest();
    const anchors = [{ x: 0.1, y: 0.5 }, { x: 0.35, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.85, y: 0.5 }];
    const raw = JSON.parse(JSON.stringify(m));
    raw.questions[0].anchors = anchors;
    const ok = validateManifest(raw);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const q = ok.manifest.questions[0];
      expect(q.type === 'multiple-choice' && q.anchors).toEqual(anchors);
      expect(ok.warnings).toEqual([]);
    }
    for (const bad of [anchors.slice(0, 3), [...anchors.slice(0, 3), { x: 1.5, y: 0 }], 'nope', [{ x: 0 }, {}, {}, {}]]) {
      const r2 = JSON.parse(JSON.stringify(m));
      r2.questions[0].anchors = bad;
      const r = validateManifest(r2);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const q = r.manifest.questions[0];
        expect(q.type === 'multiple-choice' && q.anchors).toBeUndefined();
        expect(r.warnings.some((w) => w.includes('choice positions'))).toBe(true);
      }
    }
  });

  it('rejects page count mismatches', async () => {
    const m = await sampleManifest();
    const r = validateManifest({ ...m, pdf: { ...m.pdf, pageCount: 3 } });
    expect(r.ok).toBe(false);
  });
});

describe('stripAnswerKey', () => {
  it('removes every piece of grading information and the PIN', async () => {
    const stripped = stripAnswerKey(await sampleManifest());
    const text = JSON.stringify(stripped);
    expect(text).not.toContain('"correct":"C"');
    expect(text).not.toContain('went');
    expect(text).not.toContain('reasonable essay');
    expect(text).not.toContain('1234');
    expect(stripped.questions).toHaveLength(3);
    expect(stripped.questions[0]).toMatchObject({ type: 'multiple-choice', options: ['A', 'B', 'C', 'D'], correct: '' });
  });
});

describe('export / import round trip', () => {
  it('restores the manifest and the exact PDF bytes', async () => {
    const manifest = await sampleManifest();
    const blob = await exportPackage({ manifest, pdfBlob: new Blob([fakePdf]) });
    expect(blob.size).toBeGreaterThan(0);
    const { exam, warnings } = await importPackage(await blob.arrayBuffer());
    expect(warnings).toEqual([]);
    expect(exam.manifest).toEqual(manifest);
    expect(new Uint8Array(await exam.pdfBlob.arrayBuffer())).toEqual(fakePdf);
  });

  it('rejects a non-zip file', async () => {
    await expect(importPackage(new TextEncoder().encode('hello').buffer)).rejects.toThrow(PackageError);
  });

  it('rejects a zip without the required entries', async () => {
    const zip = new JSZip();
    zip.file('something.txt', 'x');
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(importPackage(data)).rejects.toThrow(/manifest\.json/);
  });

  it('rejects an invalid manifest with details', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ formatVersion: 1, id: 'x' }));
    zip.file('exam.pdf', fakePdf);
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const err = await importPackage(data).catch((e) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect((err as PackageError).details.length).toBeGreaterThan(0);
  });

  it('rejects a package whose PDF was swapped (checksum mismatch)', async () => {
    const manifest = await sampleManifest();
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(manifest));
    zip.file('exam.pdf', new TextEncoder().encode('different bytes'));
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    await expect(importPackage(data)).rejects.toThrow(/checksum/);
  });

  it('builds a safe file name', async () => {
    expect(packageFileName(await sampleManifest())).toBe('Đề-thi-HSG-lớp-9.exam.zip');
    expect(packageFileName({ ...(await sampleManifest()), title: '///' })).toBe('exam.exam.zip');
  });
});
