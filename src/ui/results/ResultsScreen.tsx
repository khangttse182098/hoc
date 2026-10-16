import { useEffect, useMemo, useState } from 'react';
import { newId } from '../../model/ids';
import type { Attempt, Question, StoredExam } from '../../model/types';
import { clampPoints, correctAnswerText, gradeAttempt } from '../../grading/grade';
import { stripAnswerKey } from '../../package/format';
import { getAttempt, getExam, saveAttempt } from '../../storage/db';
import { PinPrompt } from '../common/PinPrompt';
import { useToast } from '../common/Toast';
import { formatDate } from '../common/download';
import { usePdfDocument } from '../common/usePdfDocument';
import { byPosition } from '../author/QuestionList';
import { navigate } from '../router';
import { ExamDocument } from '../student/ExamDocument';
import type { FieldFeedback } from '../student/StudentField';

interface Props {
  examId: string;
  attemptId: string;
}

export function ResultsScreen({ examId, attemptId }: Props) {
  const toast = useToast();
  const [exam, setExam] = useState<StoredExam | null | 'missing'>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [examiner, setExaminer] = useState(false);
  const [pinPrompt, setPinPrompt] = useState(false);
  const [onDocument, setOnDocument] = useState(false);
  const { doc, error: pdfError } = usePdfDocument(onDocument && exam && exam !== 'missing' ? exam.pdfBlob : null);

  useEffect(() => {
    (async () => {
      const e = await getExam(examId);
      const a = await getAttempt(attemptId);
      if (!e || !a) {
        setExam('missing');
        return;
      }
      setExam(e);
      setAttempt(a);
    })();
  }, [examId, attemptId]);

  const manifest = exam && exam !== 'missing' ? exam.manifest : null;
  const summary = useMemo(() => (manifest && attempt ? gradeAttempt(manifest, attempt) : null), [manifest, attempt]);
  const questions = useMemo(() => (manifest ? [...manifest.questions].sort(byPosition) : []), [manifest]);
  const studentQuestions = useMemo(() => (manifest ? stripAnswerKey(manifest).questions : []), [manifest]);

  const showKey = examiner || Boolean(manifest?.settings.showCorrectAnswersAfterSubmit);

  const feedback = useMemo<Record<string, FieldFeedback>>(() => {
    const out: Record<string, FieldFeedback> = {};
    if (!summary || !manifest) return out;
    for (const r of summary.results) {
      const q = manifest.questions.find((x) => x.id === r.questionId);
      if (!q) continue;
      out[r.questionId] = { result: r, reveal: showKey && !r.needsManualGrading && !r.correct ? correctAnswerText(q) : undefined };
    }
    return out;
  }, [summary, manifest, showKey]);

  const setManualScore = async (q: Question, value: string) => {
    if (!attempt) return;
    const manualScores = { ...attempt.manualScores };
    if (value === '') delete manualScores[q.id];
    else manualScores[q.id] = clampPoints(Number(value), q.points);
    const next = { ...attempt, manualScores, updatedAt: new Date().toISOString() };
    setAttempt(next);
    await saveAttempt(next);
  };

  const unlockExaminer = () => {
    if (manifest?.settings.authorPin) setPinPrompt(true);
    else setExaminer(true);
  };

  const tryAgain = async () => {
    const now = new Date().toISOString();
    await saveAttempt({ id: newId('att'), examId, status: 'in-progress', startedAt: now, updatedAt: now, responses: {}, manualScores: {} });
    navigate({ view: 'student', examId });
  };

  if (exam === 'missing') {
    return (
      <div className="center-msg">
        <p>This attempt or exam does not exist in this browser.</p>
        <button className="btn" onClick={() => navigate({ view: 'home' })}>Back to home</button>
      </div>
    );
  }
  if (!manifest || !attempt || !summary) return <div className="center-msg">Loading…</div>;

  if (attempt.status !== 'submitted') {
    return (
      <div className="center-msg">
        <p>This attempt has not been submitted yet.</p>
        <button className="btn primary" onClick={() => navigate({ view: 'student', examId })}>Continue the exam</button>
      </div>
    );
  }

  const header = (
    <div className="topbar">
      <button className="btn" onClick={() => navigate({ view: 'home' })}>← Home</button>
      <span className="title">Results: {manifest.title}</span>
      <button className={`btn${onDocument ? ' active' : ''}`} onClick={() => setOnDocument((s) => !s)}>
        {onDocument ? 'Show summary' : 'Show on document'}
      </button>
      {!examiner && <button className="btn" onClick={unlockExaminer}>Examiner: grade manually</button>}
      {examiner && <span className="pill accent">Examiner mode</span>}
      <button className="btn primary" onClick={() => void tryAgain()}>Try again</button>
    </div>
  );

  if (onDocument) {
    return (
      <>
        {header}
        <div className="workspace">
          {pdfError ? (
            <div className="center-msg"><p className="error">{pdfError}</p></div>
          ) : !doc ? (
            <div className="center-msg">Opening PDF…</div>
          ) : (
            <ExamDocument
              doc={doc}
              pdf={manifest.pdf}
              questions={studentQuestions}
              responses={attempt.responses}
              readOnly
              feedback={feedback}
              toolbarLeft={
                <span className="status">
                  {summary.finalPoints} / {summary.maxPoints} points ({summary.percentage}%)
                  {!summary.complete && ' · provisional'}
                </span>
              }
            />
          )}
        </div>
        {pinPrompt && <PinPrompt onCancel={() => setPinPrompt(false)} onSubmit={(pin) => { if (pin !== manifest.settings.authorPin) return false; setExaminer(true); setPinPrompt(false); return true; }} />}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="results">
        <div className="score-box">
          <div>
            <span className="lbl">{summary.complete ? 'Final score' : 'Provisional score'}</span>
            <span className="big">{summary.finalPoints} / {summary.maxPoints}</span>
          </div>
          <div>
            <span className="lbl">Percentage</span>
            <span className="big">{summary.percentage}%</span>
          </div>
          <div>
            <span className="lbl">Auto-graded</span>
            <span style={{ fontSize: 18 }}>
              <span style={{ color: 'var(--ok)' }}>{summary.correctCount} correct</span> ·{' '}
              <span style={{ color: 'var(--danger)' }}>{summary.incorrectCount} incorrect</span>
            </span>
          </div>
          {summary.results.some((r) => r.needsManualGrading) && (
            <div>
              <span className="lbl">Manual grading</span>
              <span style={{ fontSize: 18 }}>
                {summary.manualGradedCount} graded · {summary.manualPendingCount} pending
              </span>
            </div>
          )}
          <div style={{ flexBasis: '100%' }} className="hint">
            Submitted {attempt.submittedAt ? formatDate(attempt.submittedAt) : ''}.
            {summary.manualPendingCount > 0 && (
              <> Auto-graded points: {summary.provisionalPoints}. {summary.manualPendingCount} question(s) still need manual grading, so this score is provisional.</>
            )}
          </div>
        </div>

        <table className="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Type</th>
              <th>Your answer</th>
              <th>Result</th>
              <th>Points</th>
              {showKey && <th>Correct answer</th>}
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => {
              const r = summary.results.find((x) => x.questionId === q.id)!;
              const rowClass = r.needsManualGrading ? 'manual' : r.correct ? 'correct' : 'wrong';
              return (
                <tr key={q.id} className={rowClass}>
                  <td style={{ fontWeight: 600 }}>{q.number}</td>
                  <td className="hint">{q.type === 'multiple-choice' ? 'MC' : q.type === 'short-answer' ? 'Text' : 'Manual'}</td>
                  <td className="resp">{r.response === '' ? <span className="hint">(blank)</span> : r.response}</td>
                  <td>
                    {r.needsManualGrading ? (
                      r.manualPoints === null ? <span className="pill warn">needs grading</span> : <span className="pill ok">graded</span>
                    ) : r.correct ? (
                      <span className="pill ok">correct</span>
                    ) : (
                      <span className="pill danger">incorrect</span>
                    )}
                  </td>
                  <td>
                    {r.needsManualGrading && examiner ? (
                      <>
                        <input
                          type="number"
                          className="input small"
                          min={0}
                          max={q.points}
                          step={0.25}
                          value={r.manualPoints ?? ''}
                          placeholder="—"
                          onChange={(e) => void setManualScore(q, e.target.value)}
                        />{' '}
                        / {q.points}
                      </>
                    ) : (
                      <>
                        {r.needsManualGrading ? (r.manualPoints ?? '—') : r.autoPoints} / {q.points}
                      </>
                    )}
                  </td>
                  {showKey && (
                    <td>
                      {q.type === 'manual' ? (
                        examiner && q.modelAnswer ? <span className="resp">{q.modelAnswer}</span> : <span className="hint">manual</span>
                      ) : r.correct ? (
                        <span className="hint">✓</span>
                      ) : (
                        <span className="resp">{correctAnswerText(q)}</span>
                      )}
                      {q.explanation && <div className="hint" style={{ marginTop: 4 }}>{q.explanation}</div>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!showKey && <p className="hint" style={{ marginTop: 10 }}>Correct answers are hidden for this exam. The examiner can reveal them with the author PIN.</p>}
        {examiner && <p className="hint" style={{ marginTop: 10 }}>Manual scores are saved automatically.</p>}
      </div>
      {pinPrompt && (
        <PinPrompt
          onCancel={() => setPinPrompt(false)}
          onSubmit={(pin) => {
            if (pin !== manifest.settings.authorPin) return false;
            setExaminer(true);
            setPinPrompt(false);
            toast.show('Examiner mode enabled.');
            return true;
          }}
        />
      )}
    </>
  );
}
