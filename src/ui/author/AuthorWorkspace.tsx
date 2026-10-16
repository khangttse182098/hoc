import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extendRectToPoint, toAnchor } from '../../model/anchors';
import { createQuestion, defaultRectFor, nextQuestionNumber, type AuthorTool } from '../../model/defaults';
import { newId } from '../../model/ids';
import type { ExamManifest, NormPoint, NormRect, PageInfo, Question, StoredExam } from '../../model/types';
import { clampNormRect, normToPx } from '../../pdf/coords';
import { PdfViewer, type PdfViewerHandle } from '../../pdf/PdfViewer';
import { useZoom } from '../../pdf/useZoom';
import { exportPackage, packageFileName } from '../../package/zip';
import { getExam, saveExam } from '../../storage/db';
import { Modal } from '../common/Modal';
import { PinPrompt } from '../common/PinPrompt';
import { useToast } from '../common/Toast';
import { ViewerToolbar } from '../common/ViewerToolbar';
import { downloadBlob } from '../common/download';
import { usePdfDocument } from '../common/usePdfDocument';
import { navigate } from '../router';
import { AuthorField } from './AuthorField';
import { ExamSettingsPanel } from './ExamSettingsPanel';
import { FieldSettings } from './FieldSettings';
import { QuestionList } from './QuestionList';

interface Props {
  examId: string;
}

const AUTOSAVE_MS = 1500;

/**
 * In-memory clipboard for question fields. Module-level so a field copied in
 * one exam can be pasted into another during the same session. Never touches
 * the system clipboard: nothing leaves the page.
 */
let fieldClipboard: Question | null = null;

/** Where the mouse last was over a PDF page, in normalized page coordinates. */
interface PagePointer {
  pageIndex: number;
  nx: number;
  ny: number;
}

/** Recording where the printed A/B/C/D letters of a multiple-choice question sit. */
interface Anchoring {
  questionId: string;
  /** Index of the option to click next. */
  index: number;
}

/** A field being dragged out on the page (rubber band), before it exists. */
interface Draft {
  pageIndex: number;
  rect: NormRect;
}

/** Drags shorter than this are treated as a click (default-sized field). */
const CLICK_TOLERANCE_PX = 4;
/** Marker radius used to keep anchors inside the box, in CSS px at the current zoom. */
const ANCHOR_PAD_PX = 12;

export function AuthorWorkspace({ examId }: Props) {
  const toast = useToast();
  const [exam, setExam] = useState<StoredExam | null | 'missing'>(null);
  const [manifest, setManifest] = useState<ExamManifest | null>(null);
  const [savedManifest, setSavedManifest] = useState<ExamManifest | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<AuthorTool | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [clipboard, setClipboard] = useState<Question | null>(fieldClipboard);
  const [anchoring, setAnchoring] = useState<Anchoring | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const pointerRef = useRef<PagePointer | null>(null);
  const viewerRef = useRef<PdfViewerHandle>(null);
  const { doc, error: pdfError, loading } = usePdfDocument(exam && exam !== 'missing' ? exam.pdfBlob : null);
  const zoom = useZoom(viewerRef, 'fit-width', doc !== null);

  // Load
  useEffect(() => {
    getExam(examId).then((e) => {
      if (!e) {
        setExam('missing');
        return;
      }
      setExam(e);
      setManifest(e.manifest);
      setSavedManifest(e.manifest);
      const pin = e.manifest.settings.authorPin;
      setUnlocked(!pin || sessionStorage.getItem(`author-unlocked:${examId}`) === '1');
    });
  }, [examId]);

  const dirty = manifest !== null && manifest !== savedManifest;

  // Save (debounced autosave + Ctrl/Cmd+S)
  const save = useCallback(async () => {
    if (!manifest || exam === null || exam === 'missing' || manifest === savedManifest) return;
    const next = { ...manifest, updatedAt: new Date().toISOString() };
    await saveExam({ manifest: next, pdfBlob: exam.pdfBlob });
    setManifest((m) => (m === manifest ? next : m));
    setSavedManifest(next);
  }, [manifest, savedManifest, exam]);

  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [dirty, save]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Question mutations
  const updateQuestion = useCallback((id: string, patch: Partial<Question> | ((q: Question) => Question)) => {
    setManifest((m) =>
      m
        ? {
            ...m,
            questions: m.questions.map((q) => (q.id === id ? (typeof patch === 'function' ? patch(q) : ({ ...q, ...patch } as Question)) : q)),
          }
        : m,
    );
  }, []);

  const onChangeRect = useCallback(
    (id: string, rect: NormRect) => updateQuestion(id, { rect }),
    [updateQuestion],
  );
  const onChangeAnchors = useCallback(
    (id: string, anchors: NormPoint[]) => updateQuestion(id, (q) => (q.type === 'multiple-choice' ? { ...q, anchors } : q)),
    [updateQuestion],
  );

  const deleteQuestion = (id: string) => {
    setManifest((m) => (m ? { ...m, questions: m.questions.filter((q) => q.id !== id) } : m));
    setSelectedId((s) => (s === id ? null : s));
    setConfirmDelete(false);
  };

  const duplicateQuestion = (id: string) => {
    // Build the copy outside the state updater: React may invoke updaters
    // more than once (eager computation, StrictMode), and a fresh id per
    // invocation would leave `selectedId` pointing at a question that was
    // never stored.
    const src = manifest?.questions.find((q) => q.id === id);
    if (!manifest || !src) return;
    const copy: Question = {
      ...src,
      id: newId('q'),
      number: nextQuestionNumber(manifest.questions),
      rect: clampNormRect({ ...src.rect, y: src.rect.y + src.rect.h + 0.005 }),
    };
    setManifest((m) => (m ? { ...m, questions: [...m.questions, copy] } : m));
    setSelectedId(copy.id);
  };

  const copyQuestion = (id: string) => {
    const src = manifest?.questions.find((q) => q.id === id);
    if (!src) return;
    fieldClipboard = src;
    setClipboard(src);
    toast.show(`Copied question ${src.number}. Point at the page and press ⌘/Ctrl+V to paste.`);
  };

  /**
   * Paste the copied field as a new question with the next number and the
   * same size, type and settings. It lands centred under the mouse if the
   * mouse is over a page, otherwise just below the original.
   */
  const pasteQuestion = () => {
    const src = fieldClipboard;
    if (!manifest || !src) return;
    const at = pointerRef.current;
    const pageIndex = at ? at.pageIndex : Math.min(src.pageIndex, manifest.pdf.pageCount - 1);
    const rect = at
      ? { x: at.nx - src.rect.w / 2, y: at.ny - src.rect.h / 2, w: src.rect.w, h: src.rect.h }
      : { ...src.rect, y: src.rect.y + src.rect.h + 0.005 };
    const copy: Question = {
      ...src,
      id: newId('q'),
      number: nextQuestionNumber(manifest.questions),
      pageIndex,
      rect: clampNormRect(rect),
    };
    setManifest((m) => (m ? { ...m, questions: [...m.questions, copy] } : m));
    setSelectedId(copy.id);
    if (pageIndex !== currentPage) viewerRef.current?.scrollToPage(pageIndex);
  };

  // Track the mouse over PDF pages so paste can land under the cursor.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const pageEl = (e.target as Element | null)?.closest?.('.pdf-page');
      const slot = pageEl?.closest<HTMLElement>('.pdf-page-slot');
      const idx = slot ? Number(slot.dataset.pageIndex) : NaN;
      if (!pageEl || Number.isNaN(idx)) {
        pointerRef.current = null;
        return;
      }
      const r = pageEl.getBoundingClientRect();
      pointerRef.current = {
        pageIndex: idx,
        nx: (e.clientX - r.left) / r.width,
        ny: (e.clientY - r.top) / r.height,
      };
    };
    const onLeave = () => {
      pointerRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  /** Begin recording choice positions for a multiple-choice question. */
  const startAnchoring = (id: string) => {
    const q = manifest?.questions.find((x) => x.id === id);
    if (!q || q.type !== 'multiple-choice') return;
    updateQuestion(id, { ...q, anchors: [] });
    setTool(null);
    setSelectedId(id);
    setAnchoring({ questionId: id, index: 0 });
    if (q.pageIndex !== currentPage) viewerRef.current?.scrollToPage(q.pageIndex);
  };

  /** Stop recording; a partial set of anchors is dropped (button row fallback). */
  const cancelAnchoring = useCallback(
    (reason?: string) => {
      setAnchoring((a) => {
        if (!a) return null;
        updateQuestion(a.questionId, (q) =>
          q.type === 'multiple-choice' && (q.anchors?.length ?? 0) < q.options.length ? { ...q, anchors: undefined } : q,
        );
        if (reason) toast.show(reason);
        return null;
      });
    },
    [updateQuestion, toast],
  );

  // If the question being anchored disappears (deleted), stop anchoring.
  useEffect(() => {
    if (anchoring && !manifest?.questions.some((q) => q.id === anchoring.questionId)) setAnchoring(null);
  }, [anchoring, manifest]);

  const pagePoint = (e: { clientX: number; clientY: number }, el: Element): NormPoint => {
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  /** One click = one option position while anchoring. */
  const recordAnchor = (page: PageInfo, e: React.PointerEvent<HTMLDivElement>) => {
    if (!anchoring || !manifest) return;
    const q = manifest.questions.find((x) => x.id === anchoring.questionId);
    if (!q || q.type !== 'multiple-choice') return;
    if (page.index !== q.pageIndex) {
      toast.show(`Question ${q.number} is on page ${q.pageIndex + 1}; click its choices there.`);
      return;
    }
    const point = pagePoint(e, e.currentTarget);
    const pad = { x: ANCHOR_PAD_PX / (page.width * zoom.scale), y: ANCHOR_PAD_PX / (page.height * zoom.scale) };
    const sofar = (q.anchors ?? []).slice(0, anchoring.index);
    const grown = extendRectToPoint(q.rect, sofar, point, pad);
    const anchors = [...grown.anchors, toAnchor(grown.rect, point)];
    updateQuestion(q.id, { ...q, rect: grown.rect, anchors });
    if (anchors.length >= q.options.length) {
      setAnchoring(null);
      toast.show(`Question ${q.number}: choice positions set (${q.options.join(', ')}).`);
    } else {
      setAnchoring({ questionId: q.id, index: anchors.length });
    }
  };

  /**
   * Pointer down on a page with a tool active: drag out a box (rubber band)
   * or just click for a default-sized one. Multiple choice then continues
   * with anchoring so the author clicks each printed letter.
   */
  const drawField = (page: PageInfo, e: React.PointerEvent<HTMLDivElement>) => {
    if (!tool || !manifest) return;
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = pagePoint(e, el);
    const startClient = { x: e.clientX, y: e.clientY };
    const shift = e.shiftKey;
    const aspect = page.width / page.height;
    const theTool = tool;
    el.setPointerCapture(e.pointerId);

    const rectFrom = (cur: NormPoint): NormRect =>
      clampNormRect({
        x: Math.min(start.x, cur.x),
        y: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x),
        h: Math.abs(cur.y - start.y),
      });
    const movedEnough = (ev: { clientX: number; clientY: number }) =>
      Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) >= CLICK_TOLERANCE_PX;

    const onMove = (ev: globalThis.PointerEvent) => {
      if (!movedEnough(ev)) return;
      setDraft({ pageIndex: page.index, rect: rectFrom(pagePoint(ev, el)) });
    };
    const finish = (ev: globalThis.PointerEvent) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', finish);
      el.removeEventListener('pointercancel', finish);
      el.releasePointerCapture(ev.pointerId);
      setDraft(null);
      let rect: NormRect;
      if (ev.type === 'pointerup' && movedEnough(ev)) {
        rect = rectFrom(pagePoint(ev, el));
      } else {
        const size = defaultRectFor(theTool, aspect);
        rect = clampNormRect({ x: start.x - size.w / 2, y: start.y - size.h / 2, w: size.w, h: size.h });
      }
      // Create outside any state updater (ids must be generated exactly once).
      const q = createQuestion(theTool, page.index, rect, nextQuestionNumber(manifest.questions));
      // A/B/C/D fields continue with anchoring; True/False fields get the button row by default.
      const anchorNext = theTool === 'multiple-choice' && q.type === 'multiple-choice';
      if (anchorNext) q.anchors = [];
      setManifest((m) => (m ? { ...m, questions: [...m.questions, q] } : m));
      setSelectedId(q.id);
      if (anchorNext) {
        setAnchoring({ questionId: q.id, index: 0 });
        setTool(null);
      } else if (!shift) {
        setTool(null);
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  };

  /** Toolbar tool buttons toggle the tool; picking one abandons an unfinished anchoring. */
  const pickTool = (t: AuthorTool) => {
    if (anchoring) cancelAnchoring();
    setTool(tool === t ? null : t);
  };

  const onPagePointerDown = anchoring ? recordAnchor : tool ? drawField : undefined;
  const anchoringQuestion = anchoring ? manifest?.questions.find((q) => q.id === anchoring.questionId) : undefined;
  const anchoringOption =
    anchoringQuestion?.type === 'multiple-choice' ? anchoringQuestion.options[anchoring?.index ?? 0] : undefined;

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save().then(() => toast.show('Saved.'));
        return;
      }
      if (typing) return;
      if (e.key === 'Escape') {
        if (anchoring) {
          cancelAnchoring('Choice positions skipped; this question shows a button row instead.');
          return;
        }
        setTool(null);
        setSelectedId(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (!fieldClipboard) return;
        e.preventDefault();
        pasteQuestion();
        return;
      }
      if (!selectedId) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyQuestion(selectedId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setConfirmDelete(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateQuestion(selectedId);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const q = manifest?.questions.find((x) => x.id === selectedId);
        const page = manifest?.pdf.pages[q?.pageIndex ?? 0];
        if (!q || !page) return;
        const stepPx = e.shiftKey ? 10 : 1;
        const dx = stepPx / (page.width * zoom.scale);
        const dy = stepPx / (page.height * zoom.scale);
        const r = { ...q.rect };
        if (e.key === 'ArrowLeft') r.x -= dx;
        if (e.key === 'ArrowRight') r.x += dx;
        if (e.key === 'ArrowUp') r.y -= dy;
        if (e.key === 'ArrowDown') r.y += dy;
        updateQuestion(q.id, { rect: clampNormRect(r) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, manifest, save, zoom.scale, updateQuestion, toast, currentPage, anchoring, cancelAnchoring]);

  const selected = useMemo(() => manifest?.questions.find((q) => q.id === selectedId) ?? null, [manifest, selectedId]);

  const renderOverlay = useCallback(
    (page: PageInfo) => (
      <>
        {manifest?.questions
          .filter((q) => q.pageIndex === page.index)
          .map((q) => (
            <AuthorField
              key={q.id}
              question={q}
              page={page}
              scale={zoom.scale}
              selected={q.id === selectedId}
              onSelect={setSelectedId}
              onChangeRect={onChangeRect}
              onChangeAnchors={onChangeAnchors}
              anchoringIndex={anchoring?.questionId === q.id ? anchoring.index : null}
            />
          ))}
        {draft && draft.pageIndex === page.index && <div className="ov-draft" style={normToPx(draft.rect, page, zoom.scale)} />}
      </>
    ),
    [manifest, zoom.scale, selectedId, onChangeRect, onChangeAnchors, anchoring, draft],
  );

  const doExport = async () => {
    if (!manifest || exam === null || exam === 'missing') return;
    await save();
    const blob = await exportPackage({ manifest, pdfBlob: exam.pdfBlob });
    downloadBlob(blob, packageFileName(manifest));
    toast.show('Package exported.');
  };

  const goHome = async () => {
    await save();
    navigate({ view: 'home' });
  };

  if (exam === 'missing') {
    return (
      <div className="center-msg">
        <p>This exam does not exist in this browser.</p>
        <button className="btn" onClick={() => navigate({ view: 'home' })}>Back to home</button>
      </div>
    );
  }
  if (!manifest || exam === null) return <div className="center-msg">Loading…</div>;
  if (!unlocked) {
    return (
      <PinPrompt
        onCancel={() => navigate({ view: 'home' })}
        onSubmit={(pin) => {
          if (pin !== manifest.settings.authorPin) return false;
          sessionStorage.setItem(`author-unlocked:${examId}`, '1');
          setUnlocked(true);
          return true;
        }}
      />
    );
  }

  return (
    <>
      <div className="topbar">
        <button className="btn" onClick={() => void goHome()}>← Home</button>
        <span className="title">{manifest.title}</span>
        <span className="status">{dirty ? 'Unsaved changes…' : 'All changes saved'}</span>
        <button className="btn" onClick={() => void save().then(() => toast.show('Saved.'))} disabled={!dirty}>Save</button>
        <button className="btn" onClick={() => void doExport()}>Export package</button>
        <button className="btn primary" onClick={() => { void save().then(() => navigate({ view: 'student', examId })); }}>Open as student</button>
      </div>
      <div className="topbar" style={{ paddingTop: 6, paddingBottom: 6 }}>
        <span className="status">Add field:</span>
        <div className="btn-group">
          <button className={`btn small${tool === 'multiple-choice' ? ' active' : ''}`} onClick={() => pickTool('multiple-choice')}>Multiple choice</button>
          <button className={`btn small${tool === 'true-false' ? ' active' : ''}`} onClick={() => pickTool('true-false')} title="True / False, optionally Not Given">True / False</button>
          <button className={`btn small${tool === 'short-answer' ? ' active' : ''}`} onClick={() => pickTool('short-answer')}>Short answer</button>
          <button className={`btn small${tool === 'manual' ? ' active' : ''}`} onClick={() => pickTool('manual')}>Manual grading</button>
        </div>
        {clipboard && (
          <button className="btn small" onClick={pasteQuestion} title="Paste the copied field as a new question (⌘/Ctrl+V)">
            Paste copy of Q{clipboard.number}
          </button>
        )}
        <span className="status grow" style={anchoring ? { color: 'var(--accent)', fontWeight: 600 } : undefined}>
          {anchoring && anchoringQuestion
            ? `Question ${anchoringQuestion.number}: click on choice ${anchoringOption} (${anchoring.index + 1} of ${
                anchoringQuestion.type === 'multiple-choice' ? anchoringQuestion.options.length : 0
              }). Esc to skip the rest.`
            : tool === 'multiple-choice'
              ? 'Drag a box around the answer choices, then click each printed letter (A, B, C, D). Esc to cancel.'
              : tool
                ? 'Click or drag on the page to place the field (hold Shift to place several). Esc to cancel.'
                : clipboard
                  ? 'Point at the page and press ⌘/Ctrl+V to paste a copy there.'
                  : ''}
        </span>
        <ViewerToolbar
          pageCount={manifest.pdf.pageCount}
          currentPage={currentPage}
          onGoToPage={(i) => viewerRef.current?.scrollToPage(i)}
          scale={zoom.scale}
          mode={zoom.mode}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onSetMode={zoom.setMode}
          onSetScale={zoom.setCustom}
        />
      </div>
      <div className="workspace">
        <div className="main">
          {pdfError ? (
            <div className="center-msg"><p className="error">{pdfError}</p></div>
          ) : loading || !doc ? (
            <div className="center-msg">Opening PDF…</div>
          ) : (
            <PdfViewer
              ref={viewerRef}
              doc={doc}
              pages={manifest.pdf.pages}
              scale={zoom.scale}
              onCurrentPageChange={setCurrentPage}
              renderOverlay={renderOverlay}
              onPagePointerDown={onPagePointerDown}
              pageClassName={anchoring ? 'anchoring' : tool ? 'placing' : undefined}
            />
          )}
        </div>
        <aside className="sidebar">
          <div className="sidebar-scroll">
            {selected ? (
              <FieldSettings
                question={selected}
                onChange={(q) => updateQuestion(q.id, () => q)}
                onCopy={() => copyQuestion(selected.id)}
                onSetAnchors={() => startAnchoring(selected.id)}
                onDuplicate={() => duplicateQuestion(selected.id)}
                onDelete={() => setConfirmDelete(true)}
              />
            ) : (
              <ExamSettingsPanel manifest={manifest} onChange={setManifest} />
            )}
            <div className="sidebar-section" style={{ padding: '8px 12px' }}>
              <h3 style={{ margin: 0 }}>Questions ({manifest.questions.length})</h3>
            </div>
            <QuestionList
              questions={manifest.questions}
              selectedId={selectedId}
              onSelect={(q) => {
                if (anchoring && anchoring.questionId !== q.id) cancelAnchoring();
                setSelectedId(q.id);
                if (q.pageIndex !== currentPage) viewerRef.current?.scrollToPage(q.pageIndex);
              }}
            />
          </div>
        </aside>
      </div>
      {confirmDelete && selected && (
        <Modal
          title={`Delete question ${selected.number}?`}
          onClose={() => setConfirmDelete(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
              <button className="btn danger" onClick={() => deleteQuestion(selected.id)}>Delete</button>
            </>
          }
        >
          <p>The field and its answer key will be removed.</p>
        </Modal>
      )}
    </>
  );
}
