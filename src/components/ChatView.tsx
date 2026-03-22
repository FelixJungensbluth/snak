import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, Paperclip, X, FileText, FileCode } from "lucide-react";
import { type Chat, type Message, type Attachment } from "../stores/chatStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useChatEngine } from "../hooks/useChatEngine";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as api from "../api/workspace";

import ModelSelector from "./ModelSelector";
import MarkdownRenderer from "./MarkdownRenderer";
import { MODEL_CONTEXT_LIMITS, estimateTokens } from "../providers";

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

  const setScrollPosition = useSessionStore((s) => s.setScrollPosition);
  const scrollPositions = useSessionStore((s) => s.scrollPositions);
  const scrollToMessageId = useUiStore((s) => s.scrollToMessageId);
  const setScrollToMessageId = useUiStore((s) => s.setScrollToMessageId);

  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);

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
        setDragOver(true);
      } else if (event.payload.type === "leave") {
        setDragOver(false);
      } else if (event.payload.type === "drop") {
        setDragOver(false);
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
    setInput("");
    setPendingAttachments([]);
    sendMessage(text, attachments);
  }, [input, pendingAttachments, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chat.messages.length === 0 && (
          <p className="text-xs text-fg-dim text-center mt-8">
            No messages yet. Start the conversation below.
          </p>
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
          <div className="flex justify-start">
            <div className="max-w-[75%] px-3 py-2 text-xs leading-relaxed bg-surface-raised text-fg-error">
              Error: {streamError}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
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
  const isAssistant = message.role === "assistant";

  const imageAttachments = message.attachments?.filter((a) => a.type === "image") ?? [];
  const displayContent = imageAttachments.length > 0 ? stripImageMarkdown(message.content) : message.content;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? "bg-accent text-fg"
            : isSystem
              ? "bg-surface-raised text-fg-muted italic whitespace-pre-wrap"
              : "bg-surface-raised text-fg markdown-body"
        }`}
      >
        {/* Render image attachments */}
        {imageAttachments.map((att, i) => (
          <AttachmentImage key={`${att.path}-${i}`} attachment={att} />
        ))}

        {isAssistant ? (
          <>
            <MarkdownRenderer content={displayContent} />
            {isStreaming && <StreamingCursor />}
          </>
        ) : isUser ? (
          <>
            {displayContent && <span className="whitespace-pre-wrap">{displayContent}</span>}
            {isStreaming && <StreamingCursor />}
          </>
        ) : (
          <>
            {displayContent}
            {isStreaming && <StreamingCursor />}
          </>
        )}
      </div>
    </div>
  );
});

function StreamingCursor() {
  return (
    <span className="inline-block w-[6px] h-[14px] bg-fg-muted ml-0.5 align-text-bottom animate-pulse" />
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
