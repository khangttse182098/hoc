import type { ExamManifest } from '../../model/types';
import { hasAnswerKey } from '../../grading/grade';

interface Props {
  manifest: ExamManifest;
  onChange: (m: ExamManifest) => void;
}

export function ExamSettingsPanel({ manifest: m, onChange }: Props) {
  const total = m.questions.reduce((s, q) => s + q.points, 0);
  const missing = m.questions.filter((q) => !hasAnswerKey(q)).length;
  const manual = m.questions.filter((q) => q.type === 'manual').length;
  const setSettings = (patch: Partial<ExamManifest['settings']>) => onChange({ ...m, settings: { ...m.settings, ...patch } });
  return (
    <div className="sidebar-section">
      <h2>Exam</h2>
      <div className="field">
        <label>Title</label>
        <input className="input" value={m.title} onChange={(e) => onChange({ ...m, title: e.target.value })} />
      </div>
      <div className="field">
        <label>Description</label>
        <textarea className="textarea" rows={2} value={m.description} onChange={(e) => onChange({ ...m, description: e.target.value })} />
      </div>
      <label className="check">
        <input type="checkbox" checked={m.settings.showCorrectAnswersAfterSubmit} onChange={(e) => setSettings({ showCorrectAnswersAfterSubmit: e.target.checked })} />
        Show correct answers after submission
      </label>
      <label className="check">
        <input type="checkbox" checked={m.settings.practiceMode} onChange={(e) => setSettings({ practiceMode: e.target.checked })} />
        Practice mode (instant feedback while answering; reveals the key)
      </label>
      <div className="field" style={{ marginTop: 8 }}>
        <label>Author PIN (optional, blocks accidental editing)</label>
        <input className="input small" value={m.settings.authorPin ?? ''} onChange={(e) => setSettings({ authorPin: e.target.value || undefined })} placeholder="none" />
      </div>
      <div className="hint">
        {m.questions.length} questions · {total} points
        {manual > 0 && <> · {manual} manual</>}
        {missing > 0 && <> · <span className="error">{missing} without answer key</span></>}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        PDF: {m.pdf.fileName} · {m.pdf.pageCount} pages
      </div>
    </div>
  );
}
