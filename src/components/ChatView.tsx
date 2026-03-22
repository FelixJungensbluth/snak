import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, Paperclip, X, FileText, FileCode, Bot, User } from "lucide-react";
import { type Chat, type Message, type Attachment } from "../stores/chatStore";
import { useChatDraftStore } from "../stores/chatDraftStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatEngine } from "../hooks/useChatEngine";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as api from "../api/workspace";

import { lazy, Suspense } from "react";
import ModelSelector from "./ModelSelector";
import { MODEL_CONTEXT_LIMITS, estimateTokens } from "../providers";
import {
  getActiveMentionQuery,
  replaceMentionAtRange,
} from "../utils/fileNodes";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

interface ChatViewProps {
  chatId: string;
}

/** Pending attachment before send — uses absolute path for Rust access. */
interface PendingAttachment {
  type: "image" | "pdf" | "markdown";
  path: string;
  name: string;
  /** Data URL for image thumbnail preview */
  preview?: string;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PDF_EXTS = new Set(["pdf"]);
const MD_EXTS = new Set(["md", "markdown", "txt"]);

function classifyFile(name: string): PendingAttachment["type"] | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (PDF_EXTS.has(ext)) return "pdf";
  if (MD_EXTS.has(ext)) return "markdown";
  return null;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const { chat, loading, error, streamError, sendMessage, abort } = useChatEngine(chatId);

  const input = useChatDraftStore((s) => s.drafts[chatId] ?? "");
  const setDraft = useChatDraftStore((s) => s.setDraft);
  const clearDraft = useChatDraftStore((s) => s.clearDraft);
  const setScrollPosition = useSessionStore((s) => s.setScrollPosition);
  const scrollPositions = useSessionStore((s) => s.scrollPositions);
  const scrollToMessageId = useUiStore((s) => s.scrollToMessageId);
  const setScrollToMessageId = useUiStore((s) => s.setScrollToMessageId);
  const fileNodes = useWorkspaceStore((s) => s.index.fileNodes);

  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionRange, setMentionRange] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isInitialLoad = useRef(true);
  const prevMessageCount = useRef(0);

  // Restore saved scroll position when switching chats; scroll to bottom on load
  useEffect(() => {
    isInitialLoad.current = true;
    prevMessageCount.current = 0;
  }, [chatId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !chat) return;

    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      const saved = scrollPositions[chatId];
      if (saved != null) {
        el.scrollTop = saved;
      } else {
        // First time opening this chat — jump to bottom instantly
        el.scrollTop = el.scrollHeight;
      }
      prevMessageCount.current = chat.messages.length;
      return;
    }

    // Auto-scroll to bottom only when new messages are added (user sent or streaming)
    if (chat.messages.length > prevMessageCount.current || chat.streaming) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessageCount.current = chat.messages.length;
  }, [chatId, chat?.messages.length, chat?.streaming, chat?.streamBuffer]);

  // Scroll to a specific message when navigating from search
  useEffect(() => {
    if (!scrollToMessageId || !chat || !scrollRef.current) return;
    // Defer to next frame so messages are rendered
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(
        `[data-msg-id="${scrollToMessageId}"]`
      ) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash highlight
        el.classList.add("search-highlight");
        setTimeout(() => el.classList.remove("search-highlight"), 2000);
      }
      setScrollToMessageId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollToMessageId, chat, setScrollToMessageId]);

  // Save scroll position on scroll (throttled) and before unmount / chat switch
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        setScrollPosition(chatId, el.scrollTop);
      }, 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
      setScrollPosition(chatId, el.scrollTop);
    };
  }, [chatId, setScrollPosition]);

  // ── Attachment handling ──────────────────────────────────────────────────

  const updateMentionState = useCallback((value: string, cursor?: number | null) => {
    const textarea = inputRef.current;
    const nextCursor = cursor ?? textarea?.selectionStart ?? value.length;
    const activeMention = getActiveMentionQuery(value, nextCursor);
    setMentionRange(activeMention);
    setMentionIndex(0);
  }, []);

  const mentionSuggestions = useMemo(() => {
    if (!mentionRange) return [];
    const query = mentionRange.query.trim().toLowerCase();
    const filtered = query
      ? fileNodes.filter((node) => node.name.toLowerCase().includes(query))
      : fileNodes;
    return filtered.slice(0, 8);
  }, [fileNodes, mentionRange]);

  const addFiles = useCallback(async (paths: string[]) => {
    const newAttachments: PendingAttachment[] = [];
    for (const path of paths) {
      const name = path.split("/").pop() ?? path;
      const type = classifyFile(name);
      if (!type) continue;

      const att: PendingAttachment = { type, path, name };
      if (type === "image") {
        try {
          const [data, mime] = await api.readFileBase64(path);
          att.preview = `data:${mime};base64,${data}`;
        } catch (e) {
          console.error("Failed to load image preview:", e);
        }
      }
      newAttachments.push(att);
    }
    if (newAttachments.length > 0) {
      setPendingAttachments((prev) => [...prev, ...newAttachments]);
    }
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleFilePicker = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [
        { name: "Supported files", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "md", "markdown", "txt"] },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      addFiles(paths);
    }
  }, [addFiles]);

  // ── Tauri native drag & drop ────────────────────────────────────────────

  // Use a ref to access addFiles in the event listener without re-subscribing
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;

  useEffect(() => {
    const webview = getCurrentWebview();
    const unlisten = webview.onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        const x = event.payload.position.x / (window.devicePixelRatio || 1);
        const y = event.payload.position.y / (window.devicePixelRatio || 1);
        const dropTarget = document.elementFromPoint(x, y);
        const isInsideChat = !!dropTarget && !!rootRef.current?.contains(dropTarget);
        setDragOver(isInsideChat);
      } else if (event.payload.type === "leave") {
        setDragOver(false);
      } else if (event.payload.type === "drop") {
        const x = event.payload.position.x / (window.devicePixelRatio || 1);
        const y = event.payload.position.y / (window.devicePixelRatio || 1);
        const dropTarget = document.elementFromPoint(x, y);
        const isInsideChat = !!dropTarget && !!rootRef.current?.contains(dropTarget);
        setDragOver(false);
        if (!isInsideChat) return;
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          addFilesRef.current(paths);
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [chatId]);

  // ── Send ────────────────────────────────────────────────────────────────

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text && pendingAttachments.length === 0) return;
    const attachments: Attachment[] = pendingAttachments.map((a) => ({
      type: a.type,
      path: a.path,
      name: a.name,
    }));
    clearDraft(chatId);
    setPendingAttachments([]);
    sendMessage(text, attachments);
    setMentionRange(null);
    setMentionIndex(0);
  }, [chatId, clearDraft, input, pendingAttachments, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionSuggestions.length > 0 && mentionRange) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const selected = mentionSuggestions[mentionIndex];
        if (selected) {
          const { nextValue, nextCursor } = replaceMentionAtRange(
            input,
            mentionRange.start,
            mentionRange.end,
            selected.name,
          );
          setDraft(chatId, nextValue);
          setMentionRange(null);
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(nextCursor, nextCursor);
          });
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionRange(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-fg-dim text-xs">
        Loading chat…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-fg-error text-xs">
        {error}
      </div>
    );
  }

  if (!chat) return null;

  return (
    <div ref={rootRef} className="flex flex-col h-full">
      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {chat.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-fg-dim">
            <Bot size={28} className="opacity-40" />
            <p className="text-xs">Start the conversation below.</p>
          </div>
        )}
        {chat.messages.map((msg, i) => (
          <div key={msg.id} data-msg-id={msg.id}>
            <MessageBubble
              message={msg}
              isStreaming={
                chat.streaming &&
                i === chat.messages.length - 1 &&
                msg.role === "assistant"
              }
            />
          </div>
        ))}
        {streamError && (
          <div className="flex gap-2.5 pr-12">
            <div className="w-6 shrink-0" />
            <div className="text-[12px] text-fg-error bg-fg-error/10 rounded-lg px-3 py-2">
              {streamError}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Token counter */}
      {chat.messages.length > 0 && <TokenCounter chat={chat} />}

      {/* Input area */}
      <div
        className={`border-t border-border bg-surface relative ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}
      >
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface/80 pointer-events-none">
            <span className="text-xs text-fg-muted">Drop files to attach</span>
          </div>
        )}

        <div className="flex items-center gap-2 px-3 pt-2">
          <ModelSelector chatId={chatId} />
        </div>

        {/* Attachment chips */}
        {pendingAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2">
            {pendingAttachments.map((att, i) => (
              <AttachmentChip key={`${att.path}-${i}`} attachment={att} onRemove={() => removeAttachment(i)} />
            ))}
          </div>
        )}

        {mentionSuggestions.length > 0 && mentionRange && (
          <div className="mx-3 mt-2 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg">
            {mentionSuggestions.map((node, index) => (
              <button
                key={node.id}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors ${
                  index === mentionIndex ? "bg-accent-selection text-fg" : "text-fg-muted hover:bg-surface-hover"
                }`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  const { nextValue, nextCursor } = replaceMentionAtRange(
                    input,
                    mentionRange.start,
                    mentionRange.end,
                    node.name,
                  );
                  setDraft(chatId, nextValue);
                  setMentionRange(null);
                  requestAnimationFrame(() => {
                    inputRef.current?.focus();
                    inputRef.current?.setSelectionRange(nextCursor, nextCursor);
                  });
                }}
              >
                <FileText size={12} className="shrink-0" />
                <span className="truncate">{node.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end">
          <button
            onClick={handleFilePicker}
            disabled={chat.streaming}
            className="px-2 pb-3 pt-3 text-fg-muted hover:text-fg disabled:opacity-30 transition-colors"
            title="Attach file"
          >
            <Paperclip size={14} />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setDraft(chatId, e.target.value);
              updateMentionState(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onClick={() => updateMentionState(input)}
            onKeyUp={() => updateMentionState(input)}
            placeholder="Type a message…"
            rows={1}
            disabled={chat.streaming}
            className="flex-1 resize-none bg-transparent text-fg text-xs px-1 py-3 outline-none min-h-[80px] max-h-[200px] disabled:opacity-50"
          />
          {chat.streaming ? (
            <button
              onClick={abort}
              className="border-l border-border px-3 text-fg-error hover:text-fg transition-colors self-stretch flex items-end pb-3"
              title="Stop generation"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && pendingAttachments.length === 0}
              className="border-l border-border px-3 text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-stretch flex items-end pb-3"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AttachmentChip({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
  if (attachment.preview) {
    // Image thumbnail — compact square with remove button
    return (
      <div className="relative group w-14 h-14 shrink-0">
        <img
          src={attachment.preview}
          alt={attachment.name}
          className="w-14 h-14 rounded border border-border object-cover"
        />
        <button
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-bg border border-border flex items-center justify-center text-fg-dim hover:text-fg-error hover:border-fg-error transition-colors opacity-0 group-hover:opacity-100"
          title="Remove"
        >
          <X size={8} />
        </button>
      </div>
    );
  }

  // Non-image file chip
  const icon = attachment.type === "pdf" ? <FileText size={12} /> : <FileCode size={12} />;

  return (
    <div className="flex items-center gap-1.5 bg-surface-raised px-2 py-1 rounded text-[11px] text-fg-muted group h-14">
      {icon}
      <span className="max-w-[100px] truncate">{attachment.name}</span>
      <button
        onClick={onRemove}
        className="text-fg-dim hover:text-fg-error transition-colors ml-0.5"
        title="Remove"
      >
        <X size={10} />
      </button>
    </div>
  );
}

/** Strip markdown image references (e.g. `![name](.snak/attachments/...)`) from content */
function stripImageMarkdown(content: string): string {
  return content.replace(/\n*!\[[^\]]*\]\([^)]*\)/g, "").trim();
}

/** Renders an image attachment by loading it from disk via readFileBase64 */
function AttachmentImage({ attachment }: { attachment: Attachment }) {
  const [src, setSrc] = useState<string | null>(null);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  useEffect(() => {
    if (attachment.type !== "image" || !rootPath) return;
    const absPath = `${rootPath}/${attachment.path}`;
    api.readFileBase64(absPath).then(([data, mime]) => {
      setSrc(`data:${mime};base64,${data}`);
    }).catch((e) => console.error("Failed to load attachment image:", e));
  }, [attachment, rootPath]);

  if (!src) return null;
  return <img src={src} alt={attachment.name} className="max-w-[240px] rounded my-1" />;
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const imageAttachments = message.attachments?.filter((a) => a.type === "image") ?? [];
  const displayContent = imageAttachments.length > 0 ? stripImageMarkdown(message.content) : message.content;

  if (isSystem) {
    return (
      <div className="flex justify-center px-8 py-1">
        <span className="text-[11px] text-fg-dim italic text-center whitespace-pre-wrap">
          {displayContent}
        </span>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="flex justify-end gap-2.5 pl-12">
        <div className="max-w-[75%] flex flex-col items-end gap-1">
          {/* Image attachments */}
          {imageAttachments.map((att, i) => (
            <AttachmentImage key={`${att.path}-${i}`} attachment={att} />
          ))}
          <div className="bg-accent/90 text-fg px-3.5 py-2.5 rounded-2xl rounded-br-sm text-[13px] leading-relaxed">
            {displayContent && <span className="whitespace-pre-wrap">{displayContent}</span>}
          </div>
        </div>
        <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
          <User size={13} className="text-accent" />
        </div>
      </div>
    );
  }

  // Assistant message — full width, no bubble background
  return (
    <div className="flex gap-2.5 pr-12">
      <div className="w-6 h-6 rounded-full bg-surface-raised flex items-center justify-center shrink-0 mt-0.5">
        <Bot size={13} className="text-icon-chat" />
      </div>
      <div className="min-w-0 flex-1 text-fg text-[13px] leading-relaxed markdown-body">
        {/* Image attachments */}
        {imageAttachments.map((att, i) => (
          <AttachmentImage key={`${att.path}-${i}`} attachment={att} />
        ))}
        <Suspense fallback={<span className="whitespace-pre-wrap">{displayContent}</span>}>
          <MarkdownRenderer content={displayContent} />
        </Suspense>
        {isStreaming && <StreamingCursor />}
      </div>
    </div>
  );
});

function StreamingCursor() {
  return (
    <span className="inline-block w-[5px] h-[15px] bg-accent rounded-sm ml-0.5 align-text-bottom animate-pulse" />
  );
}

const TokenCounter = memo(function TokenCounter({ chat }: { chat: Chat }) {
  const contextLimit = MODEL_CONTEXT_LIMITS[chat.model] ?? 128_000;

  const totalTokens = useMemo(
    () => chat.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0),
    [chat.messages],
  );

  const pct = Math.min((totalTokens / contextLimit) * 100, 100);
  const isWarning = pct >= 80;

  const formatTokens = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="px-4 py-1.5 flex items-center gap-2" title={`~${formatTokens(totalTokens)} / ${formatTokens(contextLimit)} tokens`}>
      <div className="flex-1 h-1 bg-surface-raised rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isWarning ? "bg-fg-error" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[10px] tabular-nums shrink-0 ${isWarning ? "text-fg-error" : "text-fg-dim"}`}>
        {formatTokens(totalTokens)} / {formatTokens(contextLimit)}
      </span>
    </div>
  );
});
