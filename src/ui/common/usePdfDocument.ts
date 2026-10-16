import { useEffect, useState } from 'react';
import { destroyPdf, loadPdf, PdfLoadError, type PdfDocument } from '../../pdf/pdfjs';

interface State {
  doc: PdfDocument | null;
  error: string | null;
  loading: boolean;
}

/** Loads a PDF.js document from a Blob and destroys it on unmount/change. */
export function usePdfDocument(blob: Blob | null): State {
  const [state, setState] = useState<State>({ doc: null, error: null, loading: Boolean(blob) });
  useEffect(() => {
    if (!blob) {
      setState({ doc: null, error: null, loading: false });
      return;
    }
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    setState({ doc: null, error: null, loading: true });
    (async () => {
      try {
        const doc = await loadPdf(await blob.arrayBuffer());
        if (cancelled) {
          destroyPdf(doc);
          return;
        }
        loaded = doc;
        setState({ doc, error: null, loading: false });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof PdfLoadError ? err.message : `Could not open the PDF: ${String(err)}`;
        setState({ doc: null, error: msg, loading: false });
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) destroyPdf(loaded);
    };
  }, [blob]);
  return state;
}
