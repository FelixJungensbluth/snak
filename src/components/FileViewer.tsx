import { convertFileSrc } from "@tauri-apps/api/core";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Bot, FileText, Loader2 } from "lucide-react";
import * as api from "../api/workspace";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useChatDraftStore } from "../stores/chatDraftStore";
import { getFileViewKind, formatFileMention } from "../utils/fileNodes";
import MarkdownRenderer from "./MarkdownRenderer";

const PdfViewer = lazy(() => import("./PdfViewer"));
const PDF_FALLBACK_SRC_CACHE = new Map<string, string>();

interface FileViewerProps {
  nodeId: string;
}

function quoteSelection(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function formatFileSize(size: number | null): string | null {
  if (size == null) return null;
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const display = unitIndex === 0 ? String(value) : value.toFixed(1);
  return `${display} ${units[unitIndex]}`;
}

const CodeBlock = memo(function CodeBlock({ content }: { content: string }) {
  return (
    <pre className="overflow-auto rounded-xl border border-border bg-bg p-4 text-[12px] leading-[1.6] text-fg">
      <code>{content}</code>
    </pre>
  );
});

export default function FileViewer({ nodeId }: FileViewerProps) {
  const node = useWorkspaceStore((s) => s.index.byId.get(nodeId) ?? null);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const upsertNode = useWorkspaceStore((s) => s.upsertNode);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const openTab = useTabStore((s) => s.openTab);
  const setDraft = useChatDraftStore((s) => s.setDraft);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [fileSrc, setFileSrc] = useState<string | null>(null);
  const [pdfFallbackSrc, setPdfFallbackSrc] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const fileKind = useMemo(() => {
    if (!node) return "binary";
    return getFileViewKind(node);
  }, [node]);
  const pdfPath = useMemo(() => {
    if (!rootPath || !node?.file_path) return null;
    return `${rootPath}/${node.file_path}`;
  }, [node?.file_path, rootPath]);
  const pdfSrc = useMemo(() => {
    if (fileKind !== "pdf" || !pdfPath) return null;
    return pdfFallbackSrc ?? convertFileSrc(pdfPath);
  }, [fileKind, pdfFallbackSrc, pdfPath]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!node || !rootPath || node.type !== "file" || !node.file_path) {
        setError("File metadata is unavailable.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setTextContent(null);
      setFileSrc(null);
      setPdfFallbackSrc(() => {
        if (fileKind !== "pdf" || !pdfPath) return null;
        return PDF_FALLBACK_SRC_CACHE.get(pdfPath) ?? null;
      });

      try {
        if (fileKind === "pdf") {
          setLoading(false);
          return;
        } else if (fileKind === "image") {
          const absPath = `${rootPath}/${node.file_path}`;
          const [data, mimeType] = await api.readFileBase64(absPath);
          if (cancelled) return;
          setFileSrc(`data:${mimeType};base64,${data}`);
        } else {
          const result = await api.getFileContent(node.id);
          if (cancelled) return;
          setTextContent(result.content ?? "");
          if (
            result.mime_type !== node.mime_type ||
            result.file_path !== node.file_path ||
            result.file_size !== node.file_size
          ) {
            upsertNode({
              ...node,
              file_path: result.file_path,
              mime_type: result.mime_type,
              file_size: result.file_size,
            });
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [fileKind, node, rootPath, upsertNode]);

  const handlePdfLoadError = useCallback(async (err: Error) => {
    const message = String(err);
    if (!pdfPath || !message.includes("403") || pdfFallbackSrc) {
      setError(message);
      return;
    }

    try {
      const [base64, mimeType] = await api.readFileBase64(pdfPath);
      const fallbackSrc = `data:${mimeType};base64,${base64}`;
      PDF_FALLBACK_SRC_CACHE.set(pdfPath, fallbackSrc);
      setPdfFallbackSrc(fallbackSrc);
      setError(null);
    } catch (fallbackErr) {
      setError(`${message}\nFallback load failed: ${String(fallbackErr)}`);
    }
  }, [pdfFallbackSrc, pdfPath]);

  const handleAskAi = async (selection: string) => {
    if (!node) return;

    try {
      const chat = await api.createChat(defaultProvider, defaultModel, node.parent_id);
      upsertNode(chat);

      const selectionBlock = quoteSelection(selection.trim());
      const draft = `${formatFileMention(node.name)}\n\nSelected passage:\n${selectionBlock}\n\n`;
      setDraft(chat.id, draft);
      openTab(focusedPaneId, chat.id);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      console.error("Failed to open Ask AI chat:", err);
    }
  };

  if (!node || node.type !== "file") {
    return (
      <div className="flex h-full items-center justify-center text-fg-dim text-xs">
        File not found.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm text-fg">
          <FileText size={14} className="text-fg-muted" />
          <span className="truncate font-medium">{node.name}</span>
        </div>
        <div className="mt-1 text-[11px] text-fg-dim">
          {[node.mime_type, formatFileSize(node.file_size)].filter(Boolean).join("  •  ")}
        </div>
      </div>

      <div ref={containerRef} className="relative flex-1 overflow-auto px-4 py-4">
        <SelectionToolbar containerRef={containerRef} viewerRef={viewerRef} onAskAi={handleAskAi} />

        <div ref={viewerRef} className="mx-auto w-full max-w-[920px]">
          {loading ? (
            <div className="flex h-full min-h-[240px] items-center justify-center gap-2 text-fg-dim">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">Loading file…</span>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-fg-error/20 bg-fg-error/10 px-4 py-3 text-xs text-fg-error">
              {error}
            </div>
          ) : fileKind === "markdown" ? (
            <div className="markdown-body text-[13px] leading-relaxed text-fg">
              <MarkdownRenderer content={textContent ?? ""} />
            </div>
          ) : fileKind === "code" ? (
            <CodeBlock content={textContent ?? ""} />
          ) : fileKind === "text" ? (
            <div className="rounded-xl border border-border bg-surface-raised p-4">
              <pre className="whitespace-pre-wrap break-words text-[12px] leading-[1.65] text-fg">
                {textContent ?? ""}
              </pre>
            </div>
          ) : fileKind === "image" ? (
            fileSrc ? (
              <img
                src={fileSrc}
                alt={node.name}
                className="mx-auto max-h-full max-w-full rounded-xl border border-border bg-bg object-contain"
              />
            ) : null
          ) : fileKind === "pdf" ? (
            pdfSrc ? (
              <Suspense
                fallback={
                  <div className="flex min-h-[240px] items-center justify-center gap-2 text-fg-dim">
                    <Loader2 size={14} className="animate-spin" />
                    <span className="text-xs">Loading PDF…</span>
                  </div>
                }
              >
                <PdfViewer
                  src={pdfSrc}
                  containerRef={containerRef}
                  onLoadError={handlePdfLoadError}
                />
              </Suspense>
            ) : null
          ) : (
            <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface-raised px-6 text-center text-fg-dim">
              <Bot size={20} className="opacity-60" />
              <p className="text-xs">This file type does not have an inline preview yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectionToolbar({
  containerRef,
  viewerRef,
  onAskAi,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  viewerRef: RefObject<HTMLDivElement | null>;
  onAskAi: (selection: string) => void | Promise<void>;
}) {
  const [selection, setSelection] = useState<string>("");
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    function updateSelection() {
      const selectionState = window.getSelection();
      const viewer = viewerRef.current;
      const container = containerRef.current;

      if (!selectionState || !viewer || !container || selectionState.rangeCount === 0) {
        setSelection("");
        setPosition(null);
        return;
      }

      const text = selectionState.toString().trim();
      const anchorNode = selectionState.anchorNode;
      const focusNode = selectionState.focusNode;

      if (
        !text ||
        !anchorNode ||
        !focusNode ||
        !viewer.contains(anchorNode) ||
        !viewer.contains(focusNode)
      ) {
        setSelection("");
        setPosition(null);
        return;
      }

      const range = selectionState.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setSelection(text);
      setPosition({
        left: rect.left - containerRect.left + rect.width / 2,
        top: rect.top - containerRect.top + container.scrollTop - 40,
      });
    }

    document.addEventListener("selectionchange", updateSelection);
    window.addEventListener("scroll", updateSelection, true);

    return () => {
      document.removeEventListener("selectionchange", updateSelection);
      window.removeEventListener("scroll", updateSelection, true);
    };
  }, [containerRef, viewerRef]);

  if (!selection || !position) return null;

  return (
    <button
      className="absolute z-20 -translate-x-1/2 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-[11px] text-fg shadow-lg hover:bg-surface-hover"
      style={{ left: position.left, top: Math.max(8, position.top) }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void onAskAi(selection)}
    >
      Ask AI
    </button>
  );
}
