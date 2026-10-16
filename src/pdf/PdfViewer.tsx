import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PageInfo } from '../model/types';
import type { PdfDocument } from './pdfjs';
import { PdfPage } from './PdfPage';
import { fitPageScale, fitWidthScale } from './coords';

export interface PdfViewerHandle {
  scrollToPage(index: number): void;
  /** Scale that makes the widest page fill the viewer width. */
  getFitWidthScale(): number;
  getFitPageScale(): number;
}

interface Props {
  doc: PdfDocument;
  pages: PageInfo[];
  scale: number;
  onCurrentPageChange?: (index: number) => void;
  renderOverlay?: (page: PageInfo) => ReactNode;
  onPagePointerDown?: (page: PageInfo, e: React.PointerEvent<HTMLDivElement>) => void;
  pageClassName?: string;
}

const PAGE_GAP = 16;
const PAGE_PADDING = 24;
/** How many viewport heights away a page may be and still keep its bitmap. */
const KEEP_ALIVE_MARGIN = '150%';

/**
 * Scrollable, zoomable multi-page viewer. Pages are laid out with their true
 * size at the current scale; bitmaps are rendered lazily via IntersectionObserver.
 */
export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { doc, pages, scale, onCurrentPageChange, renderOverlay, onPagePointerDown, pageClassName },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [visible, setVisible] = useState<Set<number>>(() => new Set([0, 1]));
  const prevScale = useRef(scale);

  useImperativeHandle(
    ref,
    () => ({
      scrollToPage(index) {
        const el = pageEls.current[index];
        const container = scrollRef.current;
        if (!el || !container) return;
        container.scrollTo({ top: el.offsetTop - PAGE_PADDING, behavior: 'auto' });
      },
      getFitWidthScale() {
        const c = scrollRef.current;
        if (!c) return 1;
        return fitWidthScale(pages, c.clientWidth, PAGE_PADDING);
      },
      getFitPageScale() {
        const c = scrollRef.current;
        if (!c) return 1;
        return fitPageScale(pages, c.clientWidth, c.clientHeight, PAGE_PADDING);
      },
    }),
    [pages],
  );

  // Keep the same relative scroll position when the scale changes.
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (!c || prevScale.current === scale) return;
    const ratio = scale / prevScale.current;
    const centerY = c.scrollTop + c.clientHeight / 2;
    c.scrollTop = centerY * ratio - c.clientHeight / 2;
    prevScale.current = scale;
  }, [scale]);

  // Track which pages are near the viewport.
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const idx = Number((entry.target as HTMLElement).dataset.pageIndex);
            if (entry.isIntersecting) next.add(idx);
            else next.delete(idx);
          }
          return next;
        });
      },
      { root: c, rootMargin: KEEP_ALIVE_MARGIN },
    );
    for (const el of pageEls.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [pages.length]);

  // Report the page that occupies the viewport center.
  const reportCurrentPage = useCallback(() => {
    const c = scrollRef.current;
    if (!c || !onCurrentPageChange) return;
    const center = c.scrollTop + c.clientHeight / 2;
    let best = 0;
    for (let i = 0; i < pageEls.current.length; i++) {
      const el = pageEls.current[i];
      if (!el) continue;
      if (el.offsetTop <= center) best = i;
      else break;
    }
    onCurrentPageChange(best);
  }, [onCurrentPageChange]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(reportCurrentPage);
    };
    c.addEventListener('scroll', onScroll, { passive: true });
    reportCurrentPage();
    return () => {
      c.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [reportCurrentPage, scale]);

  const pageNodes = useMemo(
    () =>
      pages.map((page) => (
        <div
          key={page.index}
          className="pdf-page-slot"
          data-page-index={page.index}
          ref={(el) => {
            pageEls.current[page.index] = el;
          }}
          style={{ marginBottom: PAGE_GAP }}
        >
          <PdfPage
            doc={doc}
            page={page}
            scale={scale}
            visible={visible.has(page.index)}
            overlay={renderOverlay?.(page)}
            onPointerDownCapture={onPagePointerDown ? (e) => onPagePointerDown(page, e) : undefined}
            className={pageClassName}
          />
          <div className="pdf-page-number">
            {page.index + 1} / {pages.length}
          </div>
        </div>
      )),
    [pages, doc, scale, visible, renderOverlay, onPagePointerDown, pageClassName],
  );

  return (
    <div className="pdf-viewer" ref={scrollRef}>
      <div className="pdf-viewer-inner" style={{ padding: PAGE_PADDING }}>
        {pageNodes}
      </div>
    </div>
  );
});
