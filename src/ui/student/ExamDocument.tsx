import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { PageInfo, PdfAssetInfo, Question } from '../../model/types';
import type { PdfDocument } from '../../pdf/pdfjs';
import { PdfViewer, type PdfViewerHandle } from '../../pdf/PdfViewer';
import { useZoom } from '../../pdf/useZoom';
import { ViewerToolbar } from '../common/ViewerToolbar';
import { StudentField, type FieldFeedback } from './StudentField';

interface Props {
  doc: PdfDocument;
  pdf: PdfAssetInfo;
  /** Questions WITHOUT the answer key (see stripAnswerKey). */
  questions: Question[];
  responses: Record<string, string>;
  onChange?: (id: string, value: string) => void;
  onCommit?: (id: string) => void;
  readOnly: boolean;
  feedback?: Record<string, FieldFeedback>;
  /** Extra toolbar content on the left. */
  toolbarLeft?: ReactNode;
  /** Extra toolbar content on the right. */
  toolbarRight?: ReactNode;
  scrollRequest?: { pageIndex: number; nonce: number } | null;
}

/** PDF + interactive fields + navigation toolbar, used by the student and results views. */
export function ExamDocument({ doc, pdf, questions, responses, onChange, onCommit, readOnly, feedback, toolbarLeft, toolbarRight, scrollRequest }: Props) {
  const viewerRef = useRef<PdfViewerHandle>(null);
  const zoom = useZoom(viewerRef);
  const [currentPage, setCurrentPage] = useState(0);
  const lastScroll = useRef<number>(-1);

  if (scrollRequest && scrollRequest.nonce !== lastScroll.current) {
    lastScroll.current = scrollRequest.nonce;
    // Defer until the viewer has laid out.
    setTimeout(() => viewerRef.current?.scrollToPage(scrollRequest.pageIndex), 0);
  }

  const renderOverlay = useCallback(
    (page: PageInfo) =>
      questions
        .filter((q) => q.pageIndex === page.index)
        .map((q) => (
          <StudentField
            key={q.id}
            question={q}
            page={page}
            scale={zoom.scale}
            value={responses[q.id] ?? ''}
            onChange={onChange}
            onCommit={onCommit}
            readOnly={readOnly}
            feedback={feedback?.[q.id]}
          />
        )),
    [questions, responses, onChange, onCommit, readOnly, feedback, zoom.scale],
  );

  return (
    <div className="main">
      <div className="topbar" style={{ paddingTop: 6, paddingBottom: 6 }}>
        {toolbarLeft}
        <span className="spacer" />
        <ViewerToolbar
          pageCount={pdf.pageCount}
          currentPage={currentPage}
          onGoToPage={(i) => viewerRef.current?.scrollToPage(i)}
          scale={zoom.scale}
          mode={zoom.mode}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onSetMode={zoom.setMode}
          onSetScale={zoom.setCustom}
        />
        {toolbarRight}
      </div>
      <PdfViewer
        ref={viewerRef}
        doc={doc}
        pages={pdf.pages}
        scale={zoom.scale}
        onCurrentPageChange={setCurrentPage}
        renderOverlay={renderOverlay}
      />
    </div>
  );
}
