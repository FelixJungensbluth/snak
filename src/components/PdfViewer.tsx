import { Loader2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const INITIAL_PDF_PAGES = 1;
const PDF_PAGE_BATCH = 1;
const PDF_PAGE_PRELOAD_MARGIN = "320px 0px";
const PDF_TEXT_LAYER_PRELOAD_MARGIN = "200px 0px";
const PDF_MAX_DEVICE_PIXEL_RATIO = 1.5;
const PDF_DOCUMENT_OPTIONS = {
  disableAutoFetch: true,
} as const;
const PDF_DOCUMENT_CACHE = new Map<string, PDFDocumentProxy>();
const PDF_DOCUMENT_PROMISES = new Map<string, Promise<PDFDocumentProxy>>();
const PDF_VIEW_STATE_CACHE = new Map<string, { visiblePages: number }>();

interface PdfViewerProps {
  src: string;
  containerRef: RefObject<HTMLDivElement | null>;
  onLoadError: (err: Error) => void | Promise<void>;
}

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function getCachedVisiblePages(src: string): number {
  return Math.max(INITIAL_PDF_PAGES, PDF_VIEW_STATE_CACHE.get(src)?.visiblePages ?? INITIAL_PDF_PAGES);
}

function getPdfDocument(src: string): Promise<PDFDocumentProxy> {
  const cached = PDF_DOCUMENT_CACHE.get(src);
  if (cached) return Promise.resolve(cached);

  const existingPromise = PDF_DOCUMENT_PROMISES.get(src);
  if (existingPromise) return existingPromise;

  const loadingTask = pdfjs.getDocument({
    url: src,
    ...PDF_DOCUMENT_OPTIONS,
  });
  const nextPromise = loadingTask.promise
    .then((pdfDoc) => {
      PDF_DOCUMENT_CACHE.set(src, pdfDoc);
      PDF_DOCUMENT_PROMISES.delete(src);
      return pdfDoc;
    })
    .catch((err) => {
      PDF_DOCUMENT_PROMISES.delete(src);
      throw err;
    });

  PDF_DOCUMENT_PROMISES.set(src, nextPromise);
  return nextPromise;
}

export default function PdfViewer({ src, containerRef, onLoadError }: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(() => PDF_DOCUMENT_CACHE.get(src) ?? null);
  const [loadingPdf, setLoadingPdf] = useState<boolean>(() => !PDF_DOCUMENT_CACHE.has(src));
  const [numPages, setNumPages] = useState<number>(() => PDF_DOCUMENT_CACHE.get(src)?.numPages ?? 0);
  const [visiblePages, setVisiblePages] = useState<number>(() => {
    const cachedDoc = PDF_DOCUMENT_CACHE.get(src);
    if (!cachedDoc) return 0;
    return Math.min(cachedDoc.numPages, getCachedVisiblePages(src));
  });
  const [pageWidth, setPageWidth] = useState<number>(720);

  const viewerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadedSrcRef = useRef<string | null>(PDF_DOCUMENT_CACHE.has(src) ? src : null);

  const pdfDevicePixelRatio = useMemo(() => {
    if (typeof window === "undefined") return 1;
    return Math.min(window.devicePixelRatio || 1, PDF_MAX_DEVICE_PIXEL_RATIO);
  }, []);

  useEffect(() => {
    if (!viewerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setPageWidth(Math.max(280, Math.floor(width - 32)));
    });
    resizeObserver.observe(viewerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cachedDoc = PDF_DOCUMENT_CACHE.get(src);

    if (cachedDoc) {
      loadedSrcRef.current = src;
      setPdfDoc(cachedDoc);
      setLoadingPdf(false);
      setNumPages(cachedDoc.numPages);
      setVisiblePages(Math.min(cachedDoc.numPages, getCachedVisiblePages(src)));
      return () => {
        cancelled = true;
      };
    }

    setLoadingPdf(true);
    setPdfDoc(null);
    setNumPages(0);
    setVisiblePages(0);

    getPdfDocument(src)
      .then((nextDoc) => {
        if (cancelled) return;
        loadedSrcRef.current = src;
        setPdfDoc(nextDoc);
        setLoadingPdf(false);
        setNumPages(nextDoc.numPages);
        setVisiblePages(Math.min(nextDoc.numPages, getCachedVisiblePages(src)));
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadingPdf(false);
        void onLoadError(normalizeError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [onLoadError, src]);

  useEffect(() => {
    if (loadedSrcRef.current !== src || numPages === 0 || visiblePages === 0) return;
    PDF_VIEW_STATE_CACHE.set(src, {
      visiblePages: Math.min(numPages, visiblePages),
    });
  }, [numPages, src, visiblePages]);

  useEffect(() => {
    const root = containerRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !pdfDoc || visiblePages >= numPages || numPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisiblePages((current) => Math.min(numPages, current + PDF_PAGE_BATCH));
      },
      {
        root,
        rootMargin: PDF_PAGE_PRELOAD_MARGIN,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [containerRef, numPages, pdfDoc, visiblePages]);

  return (
    <div ref={viewerRef} className="w-full">
      <div className="space-y-4">
        {!pdfDoc || loadingPdf ? (
          <div className="flex min-h-[240px] items-center justify-center gap-2 text-fg-dim">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Loading PDF…</span>
          </div>
        ) : (
          <>
            {Array.from({ length: visiblePages }, (_, index) => (
            <PdfPageCard
              key={index + 1}
              containerRef={containerRef}
              devicePixelRatio={pdfDevicePixelRatio}
              pdf={pdfDoc}
              pageNumber={index + 1}
              pageWidth={pageWidth}
            />
            ))}
          </>
        )}
        {pdfDoc && visiblePages < numPages && (
          <div
            ref={loadMoreRef}
            className="flex items-center justify-center py-3 text-[11px] text-fg-dim"
          >
            Loading more pages...
          </div>
        )}
      </div>
    </div>
  );
}

const PdfPageCard = memo(function PdfPageCard({
  containerRef,
  devicePixelRatio,
  pdf,
  pageNumber,
  pageWidth,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  devicePixelRatio: number;
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageWidth: number;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [shouldRenderTextLayer, setShouldRenderTextLayer] = useState(pageNumber === 1);

  useEffect(() => {
    const root = containerRef.current;
    const target = pageRef.current;
    if (!root || !target) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setShouldRenderTextLayer(entries[0]?.isIntersecting ?? false);
      },
      {
        root,
        rootMargin: PDF_TEXT_LAYER_PRELOAD_MARGIN,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [containerRef]);

  return (
    <div ref={pageRef} className="rounded-xl border border-border bg-white/95 p-3 shadow-sm">
      <Page
        pdf={pdf}
        pageNumber={pageNumber}
        width={pageWidth}
        devicePixelRatio={devicePixelRatio}
        renderAnnotationLayer={false}
        renderTextLayer={shouldRenderTextLayer}
      />
    </div>
  );
});
