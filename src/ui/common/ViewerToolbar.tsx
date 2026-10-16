import { ZOOM_STEPS, type ZoomMode } from '../../pdf/useZoom';

interface Props {
  pageCount: number;
  currentPage: number;
  onGoToPage: (index: number) => void;
  scale: number;
  mode: ZoomMode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetMode: (m: ZoomMode) => void;
  onSetScale: (s: number) => void;
}

/** Page navigation + zoom controls shared by the author and student views. */
export function ViewerToolbar(p: Props) {
  return (
    <div className="btn-group">
      <button className="btn small" onClick={() => p.onGoToPage(Math.max(0, p.currentPage - 1))} disabled={p.currentPage <= 0} title="Previous page">
        ◀
      </button>
      <span className="status">
        Page{' '}
        <input
          className="input small"
          style={{ width: 48, textAlign: 'center', display: 'inline-block' }}
          type="number"
          min={1}
          max={p.pageCount}
          value={p.currentPage + 1}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= 1 && n <= p.pageCount) p.onGoToPage(n - 1);
          }}
        />{' '}
        / {p.pageCount}
      </span>
      <button className="btn small" onClick={() => p.onGoToPage(Math.min(p.pageCount - 1, p.currentPage + 1))} disabled={p.currentPage >= p.pageCount - 1} title="Next page">
        ▶
      </button>
      <span className="divider" />
      <button className="btn small" onClick={p.onZoomOut} title="Zoom out">−</button>
      <select
        className="select"
        style={{ width: 'auto', padding: '3px 6px', fontSize: 13 }}
        value={p.mode === 'custom' ? String(p.scale) : p.mode}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'fit-width' || v === 'fit-page') p.onSetMode(v);
          else p.onSetScale(Number(v));
        }}
      >
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        {ZOOM_STEPS.map((z) => (
          <option key={z} value={String(z)}>{Math.round(z * 100)}%</option>
        ))}
        {p.mode === 'custom' && !ZOOM_STEPS.includes(p.scale) && (
          <option value={String(p.scale)}>{Math.round(p.scale * 100)}%</option>
        )}
      </select>
      <button className="btn small" onClick={p.onZoomIn} title="Zoom in">+</button>
    </div>
  );
}
