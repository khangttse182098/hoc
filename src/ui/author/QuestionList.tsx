import type { Question } from '../../model/types';
import { hasAnswerKey } from '../../grading/grade';
import { isTrueFalse } from '../../model/trueFalse';

interface Props {
  questions: Question[];
  selectedId: string | null;
  onSelect: (q: Question) => void;
}

const SHORT: Record<Question['type'], string> = { 'multiple-choice': 'MC', 'short-answer': 'Text', manual: 'Manual' };

export function QuestionList({ questions, selectedId, onSelect }: Props) {
  if (questions.length === 0) {
    return <p className="hint" style={{ padding: 12 }}>No questions yet. Use the toolbar to add a field, then click on the page where it belongs.</p>;
  }
  const sorted = [...questions].sort(byPosition);
  return (
    <ul className="qlist">
      {sorted.map((q) => (
        <li key={q.id} className={q.id === selectedId ? 'selected' : ''} onClick={() => onSelect(q)}>
          <span className="qnum">{q.number}</span>
          <span className="qtype">{isTrueFalse(q) ? 'T/F' : SHORT[q.type]} · p.{q.pageIndex + 1}</span>
          <span className="qtype">{q.points} pt</span>
          {q.type === 'manual' ? (
            <span className="pill warn">manual</span>
          ) : hasAnswerKey(q) ? (
            <span className="pill ok">key ✓</span>
          ) : (
            <span className="pill danger">no key</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Sort by page, then top-to-bottom, then left-to-right. */
export function byPosition(a: Question, b: Question): number {
  if (a.pageIndex !== b.pageIndex) return a.pageIndex - b.pageIndex;
  if (Math.abs(a.rect.y - b.rect.y) > 0.01) return a.rect.y - b.rect.y;
  return a.rect.x - b.rect.x;
}
