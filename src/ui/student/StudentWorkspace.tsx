import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newId } from '../../model/ids';
import type { Attempt, Question, StoredExam } from '../../model/types';
import { correctAnswerText, gradeQuestion, isAnswered } from '../../grading/grade';
import { stripAnswerKey } from '../../package/format';
import { getExam, listAttempts, saveAttempt } from '../../storage/db';
import { Modal } from '../common/Modal';
import { useToast } from '../common/Toast';
import { usePdfDocument } from '../common/usePdfDocument';
import { byPosition } from '../author/QuestionList';
import { navigate } from '../router';
import { ExamDocument } from './ExamDocument';
import type { FieldFeedback } from './StudentField';

interface Props {
  examId: string;
}

const SAVE_DEBOUNCE_MS = 600;

export function StudentWorkspace({ examId }: Props) {
  const toast = useToast();
  const [exam, setExam] = useState<StoredExam | null | 'missing'>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [committed, setCommitted] = useState<Record<string, true>>({});
  const [scrollRequest, setScrollRequest] = useState<{ pageIndex: number; nonce: number } | null>(null);
  const saveTimer = useRef(0);
  const { doc, error: pdfError, loading } = usePdfDocument(exam && exam !== 'missing' ? exam.pdfBlob : null);

  // Load exam and resume (or start) an attempt.
  useEffect(() => {
    (async () => {
      const e = await getExam(examId);
      if (!e) {
        setExam('missing');
        return;
      }
      setExam(e);
      const existing = (await listAttempts(examId)).find((a) => a.status === 'in-progress');
      if (existing) {
        setAttempt(existing);
        return;
      }
      const now = new Date().toISOString();
      const fresh: Attempt = { id: newId('att'), examId, status: 'in-progress', startedAt: now, updatedAt: now, responses: {}, manualScores: {} };
      await saveAttempt(fresh);
      setAttempt(fresh);
    })();
  }, [examId]);

  // The student view only ever receives questions without the answer key.
  const studentQuestions = useMemo(
    () => (exam && exam !== 'missing' ? stripAnswerKey(exam.manifest).questions : []),
    [exam],
  );
  const sortedQuestions = useMemo(() => [...studentQuestions].sort(byPosition), [studentQuestions]);

  const persist = useCallback((a: Attempt) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveAttempt(a).catch((err) => toast.error(`Could not save progress: ${String(err)}`));
    }, SAVE_DEBOUNCE_MS);
  }, [toast]);

  const onChange = useCallback(
    (id: string, value: string) => {
      setAttempt((a) => {
        if (!a) return a;
        const responses = { ...a.responses };
        if (value === '') delete responses[id];
        else responses[id] = value;
        const next = { ...a, responses, updatedAt: new Date().toISOString() };
        persist(next);
        return next;
      });
      // MC answers are "committed" immediately; text answers on blur.
      const q = studentQuestions.find((x) => x.id === id);
      if (q?.type === 'multiple-choice') setCommitted((c) => ({ ...c, [id]: true }));
      else setCommitted((c) => { if (!c[id]) return c; const n = { ...c }; delete n[id]; return n; });
    },
    [persist, studentQuestions],
  );
  const onCommit = useCallback((id: string) => setCommitted((c) => (c[id] ? c : { ...c, [id]: true })), []);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const answeredCount = useMemo(
    () => (attempt ? studentQuestions.filter((q) => isAnswered(q, attempt.responses[q.id])).length : 0),
    [attempt, studentQuestions],
  );

  // Practice mode: immediate per-question feedback using the full manifest (never rendered as a key).
  const feedback = useMemo<Record<string, FieldFeedback> | undefined>(() => {
    if (!exam || exam === 'missing' || !attempt || !exam.manifest.settings.practiceMode) return undefined;
    const out: Record<string, FieldFeedback> = {};
    for (const q of exam.manifest.questions) {
      if (q.type === 'manual' || !committed[q.id] || !isAnswered(q, attempt.responses[q.id])) continue;
      const result = gradeQuestion(q, attempt.responses[q.id], undefined);
      out[q.id] = { result, reveal: result.correct ? undefined : correctAnswerText(q) };
    }
    return out;
  }, [exam, attempt, committed]);

  const submit = async () => {
    if (!attempt) return;
    window.clearTimeout(saveTimer.current);
    const now = new Date().toISOString();
    const done: Attempt = { ...attempt, status: 'submitted', submittedAt: now, updatedAt: now };
    await saveAttempt(done);
    setConfirm(false);
    navigate({ view: 'results', examId, attemptId: done.id });
  };

  const jumpTo = (q: Question) => {
    setScrollRequest({ pageIndex: q.pageIndex, nonce: Date.now() });
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-question-id="${q.id}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    }, 80);
  };

  if (exam === 'missing') {
    return (
      <div className="center-msg">
        <p>This exam does not exist in this browser.</p>
        <button className="btn" onClick={() => navigate({ view: 'home' })}>Back to home</button>
      </div>
    );
  }
  if (!exam || !attempt) return <div className="center-msg">Loading…</div>;

  const total = studentQuestions.length;
  const unanswered = sortedQuestions.filter((q) => !isAnswered(q, attempt.responses[q.id]));

  return (
    <>
      <div className="topbar">
        <button className="btn" onClick={() => navigate({ view: 'home' })}>← Home</button>
        <span className="title">{exam.manifest.title}</span>
        {exam.manifest.settings.practiceMode && <span className="pill accent">Practice mode</span>}
        <span className="status">
          Answered {answeredCount} / {total}
        </span>
        <div className="progress" title={`${answeredCount} of ${total} answered`}>
          <div style={{ width: total ? `${(answeredCount / total) * 100}%` : 0 }} />
        </div>
        <button className={`btn${showReview ? ' active' : ''}`} onClick={() => setShowReview((s) => !s)}>Review</button>
        <button className="btn primary" onClick={() => setConfirm(true)} disabled={total === 0}>Submit exam</button>
      </div>
      <div className="workspace">
        {pdfError ? (
          <div className="center-msg"><p className="error">{pdfError}</p></div>
        ) : loading || !doc ? (
          <div className="center-msg">Opening PDF…</div>
        ) : (
          <ExamDocument
            doc={doc}
            pdf={exam.manifest.pdf}
            questions={studentQuestions}
            responses={attempt.responses}
            onChange={onChange}
            onCommit={onCommit}
            readOnly={false}
            feedback={feedback}
            scrollRequest={scrollRequest}
            toolbarLeft={<span className="status">Click an option or type in a box to answer. Progress is saved automatically.</span>}
          />
        )}
        {showReview && (
          <aside className="sidebar">
            <div className="sidebar-section">
              <h2>Review</h2>
              <p className="hint">
                {unanswered.length === 0 ? 'All questions answered.' : `${unanswered.length} unanswered. Click a question to jump to it.`}
              </p>
            </div>
            <div className="sidebar-scroll">
              <ul className="qlist">
                {sortedQuestions.map((q) => {
                  const answered = isAnswered(q, attempt.responses[q.id]);
                  return (
                    <li key={q.id} onClick={() => jumpTo(q)} style={{ gridTemplateColumns: '44px 1fr auto' }}>
                      <span className="qnum">{q.number}</span>
                      <span className="qtype">p.{q.pageIndex + 1} · {q.type === 'multiple-choice' ? attempt.responses[q.id] ?? '' : truncate(attempt.responses[q.id] ?? '')}</span>
                      <span className={`pill ${answered ? 'ok' : 'warn'}`}>{answered ? 'answered' : 'empty'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </aside>
        )}
      </div>
      {confirm && (
        <Modal
          title="Submit exam?"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirm(false)}>Keep working</button>
              <button className="btn primary" onClick={() => void submit()}>Submit</button>
            </>
          }
        >
          <p>
            You answered <strong>{answeredCount}</strong> of <strong>{total}</strong> questions.
            {unanswered.length > 0 && <> <strong>{unanswered.length}</strong> are still empty.</>}
          </p>
          <p className="hint">After submitting you cannot change your answers.</p>
        </Modal>
      )}
    </>
  );
}

function truncate(s: string, n = 24): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
