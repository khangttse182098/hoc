import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { createManifest } from '../model/defaults';
import { newId } from '../model/ids';
import type { Attempt, StoredExam } from '../model/types';
import { destroyPdf, loadPdf, PdfLoadError, readPageInfos } from '../pdf/pdfjs';
import { sha256Hex } from '../package/hash';
import { exportPackage, importPackage, PackageError, packageFileName } from '../package/zip';
import { PACKAGE_EXTENSION } from '../package/format';
import { clearAttempts, deleteExam, examExists, getExam, listAttempts, listExams, saveExam, type ExamSummary } from '../storage/db';
import { Modal } from './common/Modal';
import { PinPrompt } from './common/PinPrompt';
import { useToast } from './common/Toast';
import { downloadBlob, formatDate } from './common/download';
import { navigate } from './router';

type Pending =
  | { kind: 'conflict'; exam: StoredExam; warnings: string[] }
  | { kind: 'delete'; exam: ExamSummary }
  | { kind: 'clear-attempts'; exam: ExamSummary }
  | { kind: 'pin'; exam: ExamSummary; pin: string }
  | { kind: 'error'; title: string; lines: string[] };

export function Home() {
  const toast = useToast();
  const [exams, setExams] = useState<ExamSummary[] | null>(null);
  const [attemptsByExam, setAttemptsByExam] = useState<Record<string, Attempt[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const pkgInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const list = await listExams();
    setExams(list);
    const map: Record<string, Attempt[]> = {};
    await Promise.all(list.map(async (e) => { map[e.id] = await listAttempts(e.id); }));
    setAttemptsByExam(map);
  }, []);

  useEffect(() => {
    refresh().catch((err) => toast.error(`Could not read saved exams: ${String(err)}`));
  }, [refresh, toast]);

  const createFromPdf = async (file: File) => {
    setBusy('Reading PDF…');
    try {
      const bytes = await file.arrayBuffer();
      const doc = await loadPdf(bytes.slice(0));
      const pages = await readPageInfos(doc);
      destroyPdf(doc);
      const title = file.name.replace(/\.pdf$/i, '') || 'Untitled exam';
      const manifest = createManifest(title, {
        fileName: file.name,
        sha256: await sha256Hex(bytes),
        byteLength: bytes.byteLength,
        pageCount: pages.length,
        pages,
      });
      await saveExam({ manifest, pdfBlob: new Blob([bytes], { type: 'application/pdf' }) });
      navigate({ view: 'author', examId: manifest.id });
    } catch (err) {
      const msg = err instanceof PdfLoadError ? err.message : `Could not open the PDF: ${String(err)}`;
      setPending({ kind: 'error', title: 'Cannot open PDF', lines: [msg] });
    } finally {
      setBusy(null);
    }
  };

  const importFromPackage = async (file: File) => {
    setBusy('Importing package…');
    try {
      const { exam, warnings } = await importPackage(file);
      if (await examExists(exam.manifest.id)) {
        setPending({ kind: 'conflict', exam, warnings });
        return;
      }
      await finishImport(exam, warnings);
    } catch (err) {
      const lines = err instanceof PackageError ? [err.message, ...err.details] : [String(err)];
      setPending({ kind: 'error', title: 'Cannot import package', lines });
    } finally {
      setBusy(null);
    }
  };

  const finishImport = async (exam: StoredExam, warnings: string[]) => {
    await saveExam(exam);
    await refresh();
    toast.show(warnings.length ? `Imported with ${warnings.length} warning(s): ${warnings[0]}` : `Imported "${exam.manifest.title}".`);
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    const file = list[0];
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) await importFromPackage(file);
    else if (lower.endsWith('.pdf') || file.type === 'application/pdf') await createFromPdf(file);
    else toast.error('Drop a PDF to create an exam, or an .exam.zip package to import one.');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const openAuthor = (exam: ExamSummary) => {
    if (exam.hasAuthorPin) {
      getExam(exam.id).then((stored) => {
        if (!stored) return;
        setPending({ kind: 'pin', exam, pin: stored.manifest.settings.authorPin ?? '' });
      });
      return;
    }
    navigate({ view: 'author', examId: exam.id });
  };

  const doExport = async (exam: ExamSummary) => {
    const stored = await getExam(exam.id);
    if (!stored) return;
    setBusy('Exporting…');
    try {
      downloadBlob(await exportPackage(stored), packageFileName(stored.manifest));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="home">
      <h1>PDF Exam Practice</h1>
      <p className="hint">
        Turn a PDF exam paper into an interactive practice exam. Everything stays in this browser; export a package to
        move an exam to another computer.
      </p>

      <div className="home-actions">
        <button className="btn primary" onClick={() => pdfInput.current?.click()} disabled={busy !== null}>
          New exam from PDF…
        </button>
        <button className="btn" onClick={() => pkgInput.current?.click()} disabled={busy !== null}>
          Import exam package…
        </button>
        {busy && <span className="status">{busy}</span>}
        <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }} />
        <input ref={pkgInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }} />
      </div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        Drop a <strong>.pdf</strong> here to create a new exam, or a <strong>{PACKAGE_EXTENSION}</strong> package to import one.
      </div>

      <h2>Saved exams</h2>
      {exams === null ? (
        <p className="hint">Loading…</p>
      ) : exams.length === 0 ? (
        <div className="empty">No saved exams yet.</div>
      ) : (
        <div className="card-list">
          {exams.map((exam) => {
            const attempts = attemptsByExam[exam.id] ?? [];
            return (
              <div key={exam.id} style={{ display: 'contents' }}>
                <div className="card">
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>
                      {exam.title} {exam.hasAuthorPin && <span className="pill muted" title="Author PIN set">🔒</span>}
                    </div>
                    <div className="meta">
                      {exam.pageCount} pages · {exam.questionCount} questions · updated {formatDate(exam.updatedAt)}
                      {attempts.length > 0 && (
                        <>
                          {' · '}
                          <button className="btn small" style={{ padding: '0 6px' }} onClick={() => setExpanded(expanded === exam.id ? null : exam.id)}>
                            {attempts.length} attempt{attempts.length === 1 ? '' : 's'} {expanded === exam.id ? '▴' : '▾'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="btn-group">
                    <button className="btn primary" onClick={() => navigate({ view: 'student', examId: exam.id })}>Practice</button>
                    <button className="btn" onClick={() => openAuthor(exam)}>Edit</button>
                    <button className="btn" onClick={() => void doExport(exam)}>Export</button>
                    <button className="btn danger" onClick={() => setPending({ kind: 'delete', exam })}>Delete</button>
                  </div>
                </div>
                {expanded === exam.id && attempts.length > 0 && (
                  <div className="card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6, background: '#fafaf8' }}>
                    {attempts.map((a) => (
                      <div key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                        <span className={`pill ${a.status === 'submitted' ? 'ok' : 'warn'}`}>{a.status === 'submitted' ? 'Submitted' : 'In progress'}</span>
                        <span className="grow meta">
                          started {formatDate(a.startedAt)}
                          {a.submittedAt ? `, submitted ${formatDate(a.submittedAt)}` : ''}
                        </span>
                        {a.status === 'submitted' ? (
                          <button className="btn small" onClick={() => navigate({ view: 'results', examId: exam.id, attemptId: a.id })}>Results</button>
                        ) : (
                          <button className="btn small" onClick={() => navigate({ view: 'student', examId: exam.id })}>Continue</button>
                        )}
                      </div>
                    ))}
                    <div>
                      <button className="btn small danger" onClick={() => setPending({ kind: 'clear-attempts', exam })}>Clear all attempts</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="hint" style={{ marginTop: 28 }}>
        Tip: browser storage can be cleared by the browser. Export important exams as packages and keep the files.
      </p>

      {pending?.kind === 'error' && (
        <Modal title={pending.title} onClose={() => setPending(null)} actions={<button className="btn primary" onClick={() => setPending(null)}>OK</button>}>
          {pending.lines.map((l, i) => <p key={i} className={i === 0 ? 'error' : 'hint'}>{l}</p>)}
        </Modal>
      )}
      {pending?.kind === 'conflict' && (
        <Modal
          title="Exam already exists"
          onClose={() => setPending(null)}
          actions={
            <>
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button
                className="btn"
                onClick={async () => {
                  const copy: StoredExam = {
                    ...pending.exam,
                    manifest: { ...pending.exam.manifest, id: newId('exam'), title: `${pending.exam.manifest.title} (imported)` },
                  };
                  setPending(null);
                  await finishImport(copy, pending.warnings);
                }}
              >
                Keep both
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  setPending(null);
                  await finishImport(pending.exam, pending.warnings);
                }}
              >
                Replace existing
              </button>
            </>
          }
        >
          <p>
            An exam with the same id (<strong>{pending.exam.manifest.title}</strong>) is already saved. Replacing it keeps
            existing attempts but overwrites the fields and answer key.
          </p>
        </Modal>
      )}
      {pending?.kind === 'delete' && (
        <Modal
          title="Delete exam?"
          onClose={() => setPending(null)}
          actions={
            <>
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button
                className="btn danger"
                onClick={async () => {
                  await deleteExam(pending.exam.id);
                  setPending(null);
                  await refresh();
                  toast.show('Exam deleted.');
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            This removes <strong>{pending.exam.title}</strong> and all its attempts from this browser. Export it first if
            you want to keep a copy.
          </p>
        </Modal>
      )}
      {pending?.kind === 'clear-attempts' && (
        <Modal
          title="Clear attempts?"
          onClose={() => setPending(null)}
          actions={
            <>
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button
                className="btn danger"
                onClick={async () => {
                  await clearAttempts(pending.exam.id);
                  setPending(null);
                  await refresh();
                  toast.show('Attempts cleared.');
                }}
              >
                Clear attempts
              </button>
            </>
          }
        >
          <p>All student attempts and results for <strong>{pending.exam.title}</strong> will be deleted. The exam itself is kept.</p>
        </Modal>
      )}
      {pending?.kind === 'pin' && (
        <PinPrompt
          onCancel={() => setPending(null)}
          onSubmit={(pin) => {
            if (pin !== pending.pin) return false;
            sessionStorage.setItem(`author-unlocked:${pending.exam.id}`, '1');
            setPending(null);
            navigate({ view: 'author', examId: pending.exam.id });
            return true;
          }}
        />
      )}
    </div>
  );
}
