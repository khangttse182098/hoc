/**
 * Thin wrapper around PDF.js: worker setup, document loading with friendly
 * errors, and page metadata extraction. All assets are served from this origin
 * (see scripts/copy-pdfjs-assets.mjs) so no network access is needed.
 */
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageInfo } from '../model/types';

/**
 * One Web Worker shared by every document for the lifetime of the tab.
 * PDF.js normally spawns (and re-downloads) a worker per document; sharing one
 * means the worker script is fetched exactly once, so the app keeps working
 * even if the local server disappears after the first load. Documents are
 * destroyed individually (see destroyPdf); the worker itself never is.
 */
let sharedWorker: pdfjsLib.PDFWorker | null = null;
function getWorker(): pdfjsLib.PDFWorker {
  if (!sharedWorker) {
    const port = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
      type: 'module',
      name: 'pdfjs-worker',
    });
    // The constructor's .d.ts declares `port?: null`, but the runtime accepts
    // a Worker (documented as "the workerPort object"); cast around the typing.
    const params = { port, name: 'pdfjs-worker' } as unknown as ConstructorParameters<
      typeof pdfjsLib.PDFWorker
    >[0];
    sharedWorker = new pdfjsLib.PDFWorker(params);
  }
  return sharedWorker;
}

const assetBase = `${import.meta.env.BASE_URL}pdfjs/`;

export type PdfDocument = PDFDocumentProxy;

export type PdfLoadErrorKind = 'encrypted' | 'invalid' | 'missing' | 'unknown';

export class PdfLoadError extends Error {
  readonly kind: PdfLoadErrorKind;
  constructor(message: string, kind: PdfLoadErrorKind) {
    super(message);
    this.name = 'PdfLoadError';
    this.kind = kind;
  }
}

export async function loadPdf(data: ArrayBuffer | Uint8Array): Promise<PdfDocument> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) {
    throw new PdfLoadError('The file is empty.', 'invalid');
  }
  try {
    const task = pdfjsLib.getDocument({
      data: bytes,
      worker: getWorker(),
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`,
      iccUrl: `${assetBase}iccs/`,
    });
    return await task.promise;
  } catch (err) {
    throw toLoadError(err);
  }
}

function toLoadError(err: unknown): PdfLoadError {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? String(err);
  if (name === 'PasswordException') {
    return new PdfLoadError(
      'This PDF is password-protected. Remove the password (e.g. print to a new PDF) and try again.',
      'encrypted',
    );
  }
  if (name === 'InvalidPDFException') {
    return new PdfLoadError('This file is not a valid PDF or is corrupted.', 'invalid');
  }
  if (name === 'MissingPDFException') {
    return new PdfLoadError('The PDF could not be read.', 'missing');
  }
  if (name === 'UnexpectedResponseException') {
    return new PdfLoadError('The PDF could not be read.', 'unknown');
  }
  return new PdfLoadError(`Could not open the PDF: ${message}`, 'unknown');
}

/** Collect displayed page sizes (scale 1, intrinsic rotation applied). */
export async function readPageInfos(doc: PdfDocument): Promise<PageInfo[]> {
  const infos: PageInfo[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    infos.push({ index: i - 1, width: vp.width, height: vp.height, rotation: page.rotate });
    page.cleanup();
  }
  return infos;
}

/**
 * Release the document and any pending requests. The shared worker stays
 * alive because it was passed in explicitly rather than created by the task.
 */
export function destroyPdf(doc: PdfDocument): void {
  void doc.loadingTask.destroy();
}
