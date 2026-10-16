import type { Question, TextMatchingRules } from '../../model/types';
import { DEFAULT_MATCHING, getDefaultNotGiven, setDefaultNotGiven, type AuthorTool } from '../../model/defaults';
import { OPTION_WORD, hasNotGiven, isTrueFalse, trueFalseOptions, withNotGiven } from '../../model/trueFalse';

interface Props {
  question: Question;
  onChange: (q: Question) => void;
  onCopy: () => void;
  /** Start (or restart) recording where the A/B/C/D letters sit on the page. */
  onSetAnchors: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

const TYPE_LABEL: Record<AuthorTool, string> = {
  'multiple-choice': 'Multiple choice',
  'true-false': 'True / False / Not Given',
  'short-answer': 'Short answer / fill in',
  manual: 'Manual grading',
};

export function FieldSettings({ question: q, onChange, onCopy, onSetAnchors, onDuplicate, onDelete }: Props) {
  const set = (patch: Partial<Question>) => onChange({ ...q, ...patch } as Question);

  // True/False is a multiple-choice question with a fixed option set.
  const shownType: AuthorTool = isTrueFalse(q) ? 'true-false' : q.type;
  const changeType = (type: AuthorTool) => {
    if (type === shownType) return;
    const base = { id: q.id, number: q.number, pageIndex: q.pageIndex, rect: q.rect, points: q.points, explanation: q.explanation };
    switch (type) {
      case 'multiple-choice':
        onChange({ ...base, type, options: ['A', 'B', 'C', 'D'], correct: '', layout: 'horizontal' });
        break;
      case 'true-false':
        onChange({ ...base, type: 'multiple-choice', options: trueFalseOptions(getDefaultNotGiven()), correct: '', layout: 'horizontal' });
        break;
      case 'short-answer':
        onChange({ ...base, type, accepted: [], matching: { ...DEFAULT_MATCHING } });
        break;
      case 'manual':
        onChange({ ...base, type, multiline: true });
        break;
    }
  };

  return (
    <div className="sidebar-section">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0, flex: 1 }}>Question {q.number}</h2>
        <span className="hint">page {q.pageIndex + 1}</span>
      </div>

      <div className="field row">
        <label>Number / label</label>
        <input className="input small" style={{ width: 110 }} value={q.number} onChange={(e) => set({ number: e.target.value })} />
      </div>
      <div className="field row">
        <label>Type</label>
        <select className="select" style={{ width: 170 }} value={shownType} onChange={(e) => changeType(e.target.value as AuthorTool)}>
          {(Object.keys(TYPE_LABEL) as AuthorTool[]).map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>
      <div className="field row">
        <label>Points</label>
        <input
          className="input small"
          style={{ width: 110 }}
          type="number"
          min={0}
          step={0.25}
          value={q.points}
          onChange={(e) => set({ points: Math.max(0, Number(e.target.value) || 0) })}
        />
      </div>

      {q.type === 'multiple-choice' && isTrueFalse(q) && (
        <label className="check">
          <input
            type="checkbox"
            checked={hasNotGiven(q)}
            onChange={(e) => {
              setDefaultNotGiven(e.target.checked);
              onChange(withNotGiven(q, e.target.checked));
            }}
          />
          Include "Not Given" (NG) as a third choice
        </label>
      )}

      {q.type === 'multiple-choice' && (
        <>
          {!isTrueFalse(q) && <div className="field">
            <label>Options (comma-separated)</label>
            <input
              className="input small"
              value={q.options.join(', ')}
              onChange={(e) => {
                const options = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                onChange({
                  ...q,
                  options,
                  correct: options.includes(q.correct) ? q.correct : '',
                  // Anchors are one-per-option; a different count means they no longer line up.
                  anchors: q.anchors && q.anchors.length === options.length ? q.anchors : undefined,
                });
              }}
              onBlur={() => {
                if (q.options.length < 2) onChange({ ...q, options: ['A', 'B'] });
              }}
            />
          </div>}
          <div className="field row">
            <label>Correct answer</label>
            <select className="select" style={{ width: 110 }} value={q.correct} onChange={(e) => onChange({ ...q, correct: e.target.value })}>
              <option value="">— not set —</option>
              {q.options.map((o) => (
                <option key={o} value={o}>{isTrueFalse(q) ? `${o} — ${OPTION_WORD[o]}` : o}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Choice positions</label>
            {q.anchors && q.anchors.length === q.options.length ? (
              <>
                <p className="hint" style={{ margin: '0 0 6px' }}>
                  Set for {q.options.join(', ')}. The student clicks a marker over each printed letter; drag a marker to adjust it.
                </p>
                <div className="btn-group">
                  <button className="btn small" onClick={onSetAnchors}>Re-do positions</button>
                  <button className="btn small" onClick={() => onChange({ ...q, anchors: undefined })}>Clear (use button row)</button>
                </div>
              </>
            ) : (
              <>
                <p className="hint" style={{ margin: '0 0 6px' }}>
                  Not set: the student sees a row of {q.options.length} buttons in the box instead of clicking the printed letters.
                </p>
                <button className="btn small" onClick={onSetAnchors}>Set choice positions</button>
              </>
            )}
          </div>
          {!(q.anchors && q.anchors.length === q.options.length) && (
            <div className="field row">
              <label>Button layout</label>
              <select className="select" style={{ width: 110 }} value={q.layout} onChange={(e) => onChange({ ...q, layout: e.target.value as 'horizontal' | 'vertical' })}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </div>
          )}
        </>
      )}

      {q.type === 'short-answer' && (
        <>
          <div className="field">
            <label>Accepted answers (one per line)</label>
            <textarea
              className="textarea"
              rows={3}
              value={q.accepted.join('\n')}
              onChange={(e) => onChange({ ...q, accepted: e.target.value.split('\n') })}
              onBlur={() => onChange({ ...q, accepted: q.accepted.map((a) => a.trim()).filter(Boolean) })}
              placeholder={'went\nhad gone'}
            />
          </div>
          <MatchingRules rules={q.matching} onChange={(matching) => onChange({ ...q, matching })} />
        </>
      )}

      {q.type === 'manual' && (
        <>
          <label className="check">
            <input type="checkbox" checked={q.multiline} onChange={(e) => onChange({ ...q, multiline: e.target.checked })} />
            Multi-line answer box
          </label>
          <div className="field">
            <label>Model answer / marking notes (examiner only)</label>
            <textarea className="textarea" rows={3} value={q.modelAnswer ?? ''} onChange={(e) => onChange({ ...q, modelAnswer: e.target.value || undefined })} />
          </div>
          <p className="hint">Manual questions are not auto-graded. You assign points on the results screen.</p>
        </>
      )}

      <div className="field">
        <label>Explanation (shown with results)</label>
        <textarea className="textarea" rows={2} value={q.explanation ?? ''} onChange={(e) => set({ explanation: e.target.value || undefined })} />
      </div>

      <div className="btn-group">
        <button className="btn small" onClick={onCopy} title="Copy this field; paste it anywhere with ⌘/Ctrl+V">Copy</button>
        <button className="btn small" onClick={onDuplicate}>Duplicate</button>
        <button className="btn small danger" onClick={onDelete}>Delete</button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        Drag to move, drag handles to resize, arrow keys to nudge. <span className="kbd">Del</span> delete, <span className="kbd">⌘/Ctrl+D</span> duplicate, <span className="kbd">⌘/Ctrl+C</span> copy then <span className="kbd">⌘/Ctrl+V</span> paste under the mouse.
      </p>
    </div>
  );
}

function MatchingRules({ rules, onChange }: { rules: TextMatchingRules; onChange: (r: TextMatchingRules) => void }) {
  const toggle = (k: keyof TextMatchingRules) => onChange({ ...rules, [k]: !rules[k] });
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="hint" style={{ marginBottom: 4 }}>Matching</div>
      <label className="check"><input type="checkbox" checked={rules.caseInsensitive} onChange={() => toggle('caseInsensitive')} /> Ignore case</label>
      <label className="check"><input type="checkbox" checked={rules.trim} onChange={() => toggle('trim')} /> Trim leading/trailing spaces</label>
      <label className="check"><input type="checkbox" checked={rules.collapseWhitespace} onChange={() => toggle('collapseWhitespace')} /> Collapse repeated spaces</label>
      <label className="check"><input type="checkbox" checked={rules.ignorePunctuation} onChange={() => toggle('ignorePunctuation')} /> Ignore punctuation</label>
      <label className="check"><input type="checkbox" checked={rules.ignoreAccents} onChange={() => toggle('ignoreAccents')} /> Ignore accents (é = e, đ = d)</label>
    </div>
  );
}
