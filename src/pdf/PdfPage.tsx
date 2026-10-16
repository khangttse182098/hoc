import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PageInfo } from '../model/types';
import type { PdfDocument } from './pdfjs';
import { pageBoxAtScale } from './coords';

interface Props {
  doc: PdfDocument;
  page: PageInfo;
  scale: number;
  /** Whether the page is near the viewport and should hold a rendered canvas. */
  visible: boolean;
  overlay?: ReactNode;
  onPointerDownCapture?: (e: React.PointerEvent<HTMLDivElement>) => void;
  className?: string;
}

/** Upper bound on canvas pixels so extreme zoom levels do not exhaust memory. */
const MAX_CANVAS_PIXELS = 24_000_000;

/**
 * Renders a single PDF page into a canvas sized to the page box at `scale`.
 * The canvas is only created while `visible` and is dropped otherwise, so large
 * documents never hold every page bitmap at once.
 */
export function PdfPage({ doc, page, scale, visible, overlay, onPointerDownCapture, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderedScale, setRenderedScale] = useState<number | null>(null);
  const box = pageBoxAtScale(page, scale);

  useEffect(() => {
    if (!visible) {
      setRenderedScale(null);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<void> } | null = null;

    (async () => {
      let pdfPage;
      try {
        pdfPage = await doc.getPage(page.index + 1);
      } catch {
        // Document was destroyed (navigation) while the page was loading.
        return;
      }
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      let pixelScale = scale * dpr;
      const vp0 = pdfPage.getViewport({ scale: pixelScale });
      const pixels = vp0.width * vp0.height;
      if (pixels > MAX_CANVAS_PIXELS) pixelScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
      const viewport = pdfPage.getViewport({ scale: pixelScale });

      // Draw into an offscreen canvas first so the old bitmap stays on screen
      // (CSS-scaled) until the new one is ready; avoids flashing blank pages.
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      renderTask = pdfPage.render({ canvas: off, viewport });
      try {
        await renderTask.promise;
      } catch (err) {
        if ((err as { name?: string })?.name === 'RenderingCancelledException') return;
        console.error('Page render failed', err);
        return;
      }
      if (cancelled) return;
      const target = canvasRef.current;
      if (!target) return;
      target.width = off.width;
      target.height = off.height;
      target.getContext('2d')?.drawImage(off, 0, 0);
      setRenderedScale(scale);
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, page.index, scale, visible]);

  return (
    <div
      className={`pdf-page${className ? ` ${className}` : ''}`}
      style={{ width: box.width, height: box.height }}
      data-page-index={page.index}
      onPointerDownCapture={onPointerDownCapture}
    >
      {visible ? (
        <canvas
          ref={canvasRef}
          className="pdf-page-canvas"
          style={{ width: box.width, height: box.height }}
          aria-label={`Page ${page.index + 1}`}
        />
      ) : (
        <div className="pdf-page-placeholder" />
      )}
      {visible && renderedScale === null && <div className="pdf-page-loading">Rendering…</div>}
      <div className="pdf-overlay-layer" style={{ width: box.width, height: box.height }}>
        {overlay}
      </div>
    </div>
  );
}
