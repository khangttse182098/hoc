import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfViewerHandle } from './PdfViewer';

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom';

export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

/**
 * Zoom state shared by the authoring and student workspaces. "fit-width" and
 * "fit-page" recompute automatically when the window is resized.
 */
export function useZoom(viewerRef: RefObject<PdfViewerHandle | null>, initial: ZoomMode = 'fit-width', ready = true) {
  const [mode, setMode] = useState<ZoomMode>(initial);
  const [scale, setScale] = useState(1);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const applyFit = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    if (modeRef.current === 'fit-width') setScale(v.getFitWidthScale());
    else if (modeRef.current === 'fit-page') setScale(v.getFitPageScale());
  }, [viewerRef]);

  useEffect(() => {
    if (!ready) return;
    applyFit();
    window.addEventListener('resize', applyFit);
    return () => window.removeEventListener('resize', applyFit);
  }, [applyFit, mode, ready]);

  const zoomIn = () => {
    setMode('custom');
    setScale((s) => ZOOM_STEPS.find((z) => z > s + 1e-6) ?? Math.min(s * 1.25, 4));
  };
  const zoomOut = () => {
    setMode('custom');
    setScale((s) => [...ZOOM_STEPS].reverse().find((z) => z < s - 1e-6) ?? Math.max(s / 1.25, 0.2));
  };
  const setCustom = (s: number) => {
    setMode('custom');
    setScale(Math.max(0.2, Math.min(4, s)));
  };

  return { mode, scale, setMode, zoomIn, zoomOut, setCustom, refit: applyFit };
}
