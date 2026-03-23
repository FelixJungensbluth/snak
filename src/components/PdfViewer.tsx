import { Loader2 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const INITIAL_PDF_PAGES = 3;
const PDF_PAGE_BATCH = 3;
const PDF_PAGE_PRELOAD_MARGIN = "600px 0px";
const PDF_TEXT_LAYER_PRELOAD_MARGIN = "200px 0px";
const PDF_MAX_DEVICE_PIXEL_RATIO = 1.5;
const PDF_DOCUMENT_OPTIONS = {} as const;

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0];

const PDF_DOCUMENT_CACHE = new Map<string, PDFDocumentProxy>();
const PDF_DOCUMENT_PROMISES = new Map<string, Promise<PDFDocumentProxy>>();
const PDF_VIEW_STATE_CACHE = new Map<
  string,
  { visiblePages: number; scrollTop: number }
>();
const PDF_INTRINSIC_WIDTH_CACHE = new Map<string, number>();

export interface PdfViewerProps {
  src: string;
  containerRef: RefObject<HTMLDivElement | null>;
  onLoadError: (err: Error) => void | Promise<void>;
  scale: number | null; // null = fit-to-width
  onScaleChange: (scale: number | null) => void;
  onIntrinsicWidthReady?: (width: number) => void;
}

function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function getCachedVisiblePages(src: string): number {
  return Math.max(
    INITIAL_PDF_PAGES,
    PDF_VIEW_STATE_CACHE.get(src)?.visiblePages ?? INITIAL_PDF_PAGES,
  );
}

export function getCachedIntrinsicWidth(src: string): number | null {
  return PDF_INTRINSIC_WIDTH_CACHE.get(src) ?? null;
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

function stepZoom(
  currentScale: number,
  direction: "in" | "out",
): number | null {
  if (direction === "in") {
    for (const step of ZOOM_STEPS) {
      if (step > currentScale + 0.01) return step;
    }
    return ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i]! < currentScale - 0.01) return ZOOM_STEPS[i]!;
  }
  return ZOOM_STEPS[0]!;
}

export { ZOOM_STEPS, stepZoom };

export default function PdfViewer({
  src,
  containerRef,
  onLoadError,
  scale,
  onScaleChange,
  onIntrinsicWidthReady,
}: PdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(
    () => PDF_DOCUMENT_CACHE.get(src) ?? null,
  );
  const [loadingPdf, setLoadingPdf] = useState<boolean>(
    () => !PDF_DOCUMENT_CACHE.has(src),
  );
  const [numPages, setNumPages] = useState<number>(
    () => PDF_DOCUMENT_CACHE.get(src)?.numPages ?? 0,
  );
  const [visiblePages, setVisiblePages] = useState<number>(() => {
    const cachedDoc = PDF_DOCUMENT_CACHE.get(src);
    if (!cachedDoc) return 0;
    return Math.min(cachedDoc.numPages, getCachedVisiblePages(src));
  });

  const [fitWidth, setFitWidth] = useState<number>(720);
  const [intrinsicWidth, setIntrinsicWidth] = useState<number>(
    () => PDF_INTRINSIC_WIDTH_CACHE.get(src) ?? 0,
  );

  const viewerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadedSrcRef = useRef<string | null>(
    PDF_DOCUMENT_CACHE.has(src) ? src : null,
  );

  // Compute effective page width based on zoom mode
  const pageWidth = useMemo(() => {
    if (scale === null) {
      // fit-to-width mode
      return Math.max(200, fitWidth);
    }
    if (intrinsicWidth > 0) {
      return Math.max(200, Math.floor(intrinsicWidth * scale));
    }
    return Math.max(200, fitWidth);
  }, [scale, fitWidth, intrinsicWidth]);

  const pdfDevicePixelRatio = useMemo(() => {
    if (typeof window === "undefined") return 1;
    return Math.min(window.devicePixelRatio || 1, PDF_MAX_DEVICE_PIXEL_RATIO);
  }, []);

  // Track container width for fit-to-width mode
  useEffect(() => {
    if (!viewerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setFitWidth(Math.max(200, Math.floor(width)));
    });
    resizeObserver.observe(viewerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Extract intrinsic page width from first page
  useEffect(() => {
    if (!pdfDoc) return;

    const cached = PDF_INTRINSIC_WIDTH_CACHE.get(src);
    if (cached) {
      setIntrinsicWidth(cached);
      onIntrinsicWidthReady?.(cached);
      return;
    }

    pdfDoc.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1.0 });
      const w = viewport.width;
      PDF_INTRINSIC_WIDTH_CACHE.set(src, w);
      setIntrinsicWidth(w);
      onIntrinsicWidthReady?.(w);
    });
  }, [pdfDoc, src, onIntrinsicWidthReady]);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    const cachedDoc = PDF_DOCUMENT_CACHE.get(src);

    if (cachedDoc) {
      loadedSrcRef.current = src;
      setPdfDoc(cachedDoc);
      setLoadingPdf(false);
      setNumPages(cachedDoc.numPages);
      setVisiblePages(
        Math.min(cachedDoc.numPages, getCachedVisiblePages(src)),
      );
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
        setVisiblePages(
          Math.min(nextDoc.numPages, getCachedVisiblePages(src)),
        );
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

  // Persist view state
  useEffect(() => {
    if (loadedSrcRef.current !== src || numPages === 0 || visiblePages === 0)
      return;
    const scrollTop = containerRef.current?.scrollTop ?? 0;
    PDF_VIEW_STATE_CACHE.set(src, {
      visiblePages: Math.min(numPages, visiblePages),
      scrollTop,
    });
  }, [numPages, src, visiblePages, containerRef]);

  // Save scroll position on unmount
  useEffect(() => {
    const container = containerRef.current;
    return () => {
      if (!container || loadedSrcRef.current !== src) return;
      const existing = PDF_VIEW_STATE_CACHE.get(src);
      if (existing) {
        existing.scrollTop = container.scrollTop;
      }
    };
  }, [containerRef, src]);

  // Restore scroll position on mount
  useEffect(() => {
    const cached = PDF_VIEW_STATE_CACHE.get(src);
    if (!cached || cached.scrollTop <= 0 || !pdfDoc) return;
    const container = containerRef.current;
    if (!container) return;

    requestAnimationFrame(() => {
      container.scrollTop = cached.scrollTop;
    });
  }, [pdfDoc, containerRef, src]);

  // Ctrl+scroll zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc) return;

    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const currentEffectiveScale =
        scale ??
        (intrinsicWidth > 0 ? fitWidth / intrinsicWidth : 1);
      const direction = e.deltaY < 0 ? "in" : "out";
      const next = stepZoom(currentEffectiveScale, direction);
      if (next !== null) {
        onScaleChange(next);
      }
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [containerRef, pdfDoc, scale, intrinsicWidth, fitWidth, onScaleChange]);

  // Intersection observer for progressive page loading
  useEffect(() => {
    const root = containerRef.current;
    const target = loadMoreRef.current;
    if (
      !root ||
      !target ||
      !pdfDoc ||
      visiblePages >= numPages ||
      numPages === 0
    )
      return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisiblePages((current) =>
          Math.min(numPages, current + PDF_PAGE_BATCH),
        );
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
      <div className="space-y-2">
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
  const [shouldRenderTextLayer, setShouldRenderTextLayer] = useState(
    pageNumber === 1,
  );
  // Track the last successfully rendered size to prevent flash during re-renders
  const [renderedSize, setRenderedSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

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

  const handleRenderSuccess = useCallback(() => {
    // Capture the rendered canvas dimensions so we can hold them as placeholder
    const canvas = pageRef.current?.querySelector("canvas");
    if (canvas) {
      setRenderedSize({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    }
  }, []);

  // Placeholder shown while the page canvas is being re-rendered.
  // Uses the last known rendered size to prevent layout shift and flash.
  const loadingPlaceholder = useMemo(() => {
    if (!renderedSize) return undefined;
    return (
      <div
        style={{
          width: renderedSize.width,
          height: renderedSize.height,
        }}
      />
    );
  }, [renderedSize]);

  return (
    <div ref={pageRef}>
      <Page
        pdf={pdf}
        pageNumber={pageNumber}
        width={pageWidth}
        devicePixelRatio={devicePixelRatio}
        renderAnnotationLayer={false}
        renderTextLayer={shouldRenderTextLayer}
        loading={loadingPlaceholder}
        onRenderSuccess={handleRenderSuccess}
      />
    </div>
  );
});
