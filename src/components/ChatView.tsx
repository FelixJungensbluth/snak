import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Square, Paperclip, X, FileText, FileCode, Bot, User, Search, Zap } from "lucide-react";
import { type Chat, type Message, type Attachment } from "../stores/chatStore";
import { useChatDraftStore } from "../stores/chatDraftStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSkillStore } from "../stores/skillStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
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
  const skills = useSkillStore((s) => s.skills);

  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionRange, setMentionRange] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const [skillRange, setSkillRange] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  // Track when selectors are explicitly dismissed so onKeyUp doesn't re-open them
  const mentionDismissedRef = useRef(false);
  const skillDismissedRef = useRef(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
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

  const updateMentionState = useCallback((value: string, cursor?: number | null, fromChange = false) => {
    const textarea = inputRef.current;
    const nextCursor = cursor ?? textarea?.selectionStart ?? value.length;

    // Only update mention state if not explicitly dismissed, or if input changed
    if (mentionDismissedRef.current && !fromChange) {
      // Stay dismissed until input changes
    } else {
      if (fromChange) mentionDismissedRef.current = false;
      const activeMention = getActiveMentionQuery(value, nextCursor);
      setMentionRange(activeMention);
      if (fromChange) setMentionIndex(0);
    }

    // Detect /skill command at the start of input
    if (skillDismissedRef.current && !fromChange) {
      // Stay dismissed until input changes
    } else {
      if (fromChange) skillDismissedRef.current = false;
      const skillMatch = value.match(/^\/(\S*)$/);
      if (!skillMatch) {
        const prefixMatch = value.match(/^\/(\S*)/);
        if (prefixMatch && nextCursor <= prefixMatch[0].length) {
          setSkillRange({ start: 0, end: prefixMatch[0].length, query: prefixMatch[1] });
          if (fromChange) setSkillIndex(0);
        } else {
          setSkillRange(null);
        }
      } else {
        setSkillRange({ start: 0, end: skillMatch[0].length, query: skillMatch[1] });
        if (fromChange) setSkillIndex(0);
      }
    }
  }, []);

  const mentionSuggestions = useMemo(() => {
    if (!mentionRange) return [];
    const query = mentionRange.query.trim().toLowerCase();
    const filtered = query
      ? fileNodes.filter((node) => node.name.toLowerCase().includes(query))
      : fileNodes;
    return filtered.slice(0, 20);
  }, [fileNodes, mentionRange]);

  const skillSuggestions = useMemo(() => {
    if (!skillRange) return [];
    const query = skillRange.query.trim().toLowerCase();
    return query
      ? skills.filter((s) => s.name.toLowerCase().includes(query))
      : skills;
  }, [skills, skillRange]);

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

    // Extract /skill command and prepend skill instructions
    let finalText = text;
    const skillMatch = text.match(/^\/(\S+)\s*/);
    if (skillMatch) {
      const skillName = skillMatch[1];
      const skill = skills.find((s) => s.name === skillName);
      if (skill) {
        const userText = text.slice(skillMatch[0].length);
        finalText = `[Skill: ${skill.name}]\n${skill.content}\n\n${userText}`;
      }
    }

    clearDraft(chatId);
    setPendingAttachments([]);
    sendMessage(finalText, attachments);
    setMentionRange(null);
    setMentionIndex(0);
    setSkillRange(null);
    setSkillIndex(0);
  }, [chatId, clearDraft, input, pendingAttachments, sendMessage, skills]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Skill autocomplete
    if (skillRange && skillSuggestions.length > 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSkillRange(null);
        skillDismissedRef.current = true;
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSkillIndex((prev) => (prev + 1) % skillSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSkillIndex((prev) => (prev - 1 + skillSuggestions.length) % skillSuggestions.length);
        return;
      }
      if ((e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
        e.preventDefault();
        const selected = skillSuggestions[skillIndex];
        if (selected) {
          const nextValue = `/${selected.name} `;
          setDraft(chatId, nextValue);
          setSkillRange(null);
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
          });
        }
        return;
      }
    }

    // Mention autocomplete
    if (mentionRange) {
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionRange(null);
        mentionDismissedRef.current = true;
        return;
      }
      if (mentionSuggestions.length > 0) {
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
        className={`border-t border-border bg-surface ${dragOver ? "ring-2 ring-accent ring-inset" : ""}`}
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

        <div className="relative">
          {skillRange && skillSuggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mx-3 mb-1 max-h-[240px] flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg z-50">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Zap size={12} className="text-fg-muted shrink-0" />
                <span className="text-[11px] text-fg-muted truncate">
                  {skillRange.query ? `/${skillRange.query}` : "Select a skill…"}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {skillSuggestions.map((skill, index) => (
                  <button
                    key={skill.name}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
                      index === skillIndex ? "bg-accent-selection text-fg" : "text-fg-muted hover:bg-surface-hover"
                    }`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      const nextValue = `/${skill.name} `;
                      setDraft(chatId, nextValue);
                      setSkillRange(null);
                      requestAnimationFrame(() => {
                        inputRef.current?.focus();
                        inputRef.current?.setSelectionRange(nextValue.length, nextValue.length);
                      });
                    }}
                  >
                    <Zap size={12} className="shrink-0" />
                    <span className="truncate font-medium">/{skill.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {mentionRange && (
            <div className="absolute bottom-full left-0 right-0 mx-3 mb-1 max-h-[240px] flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg z-50">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                <Search size={12} className="text-fg-muted shrink-0" />
                <span className="text-[11px] text-fg-muted truncate">
                  {mentionRange.query ? mentionRange.query : "Search files…"}
                </span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {mentionSuggestions.length > 0 ? (
                  mentionSuggestions.map((node, index) => (
                    <button
                      key={node.id}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
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
                      <span className="truncate font-medium">{node.name}</span>
                      {node.file_path && (
                        <span className="ml-auto text-[10px] text-fg-dim shrink-0 truncate max-w-[50%]">
                          {node.file_path.split("/").slice(0, -1).join("/")}
                        </span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-3 text-center text-[11px] text-fg-dim">
                    No files found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-end">
          <button
            onClick={handleFilePicker}
            disabled={chat.streaming}
            className="px-2 pb-3 pt-3 text-fg-muted hover:text-fg disabled:opacity-30 transition-colors"
            title="Attach file"
          >
            <Paperclip size={14} />
          </button>
          <div className="flex-1 relative min-h-[80px] max-h-[200px]">
            {/* Backdrop: renders styled mentions behind the transparent textarea text */}
            <div
              ref={backdropRef}
              aria-hidden
              className="absolute inset-0 px-1 py-3 text-xs whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
              style={{ wordBreak: "break-word" }}
            >
              {input ? (
                <InputBackdrop content={input} />
              ) : (
                <span className="text-fg-muted">Type a message…</span>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setDraft(chatId, e.target.value);
                updateMentionState(e.target.value, e.target.selectionStart, true);
              }}
              onKeyDown={handleKeyDown}
              onClick={() => updateMentionState(input)}
              onScroll={() => {
                if (backdropRef.current && inputRef.current) {
                  backdropRef.current.scrollTop = inputRef.current.scrollTop;
                }
              }}
              rows={1}
              disabled={chat.streaming}
              className="relative w-full h-full resize-none bg-transparent text-transparent text-xs px-1 py-3 outline-none min-h-[80px] max-h-[200px] disabled:opacity-50"
              style={{ caretColor: "var(--color-fg, #fff)" }}
            />
          </div>
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

/** Renders input text with @[filename] mentions and /skill prefixes styled.
 *  Characters are 1:1 with the textarea so the overlay aligns perfectly. */
function InputBackdrop({ content }: { content: string }) {
  if (!content) return null;

  // Check for /skill prefix at start
  const skillPrefixMatch = content.match(/^\/\S+/);
  let textToRender = content;
  const parts: React.ReactNode[] = [];
  let key = 0;

  if (skillPrefixMatch) {
    parts.push(
      <span key={key++} className="text-accent font-medium">
        {skillPrefixMatch[0]}
      </span>,
    );
    textToRender = content.slice(skillPrefixMatch[0].length);
  }

  // Process @mentions in remaining text
  const pattern = /@(?:\[([^\]]+)\]|\{([^}]+)\})/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(textToRender)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++} className="text-fg">{textToRender.slice(lastIndex, match.index)}</span>);
    }
    parts.push(
      <span key={key++} className="text-accent-hover underline decoration-accent-hover/40">
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < textToRender.length) {
    parts.push(<span key={key++} className="text-fg">{textToRender.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
}

/** Strip markdown image references (e.g. `![name](.snak/attachments/...)`) from content */
function stripImageMarkdown(content: string): string {
  return content.replace(/\n*!\[[^\]]*\]\([^)]*\)/g, "").trim();
}

/** Renders text with clickable @{filename} mentions that open files in tabs */
function MentionText({ content }: { content: string }) {
  const fileNodes = useWorkspaceStore((s) => s.index.fileNodes);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  const parts = useMemo(() => {
    const result: { text: string; mention?: string; nodeId?: string }[] = [];
    const pattern = /@(?:\[([^\]]+)\]|\{([^}]+)\})/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({ text: content.slice(lastIndex, match.index) });
      }
      const name = (match[1] ?? match[2])?.trim();
      const node = name ? fileNodes.find((n) => n.name === name) : undefined;
      result.push({ text: match[0], mention: name, nodeId: node?.id });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      result.push({ text: content.slice(lastIndex) });
    }
    return result;
  }, [content, fileNodes]);

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.mention ? (
          <button
            key={i}
            className="inline text-accent-hover underline decoration-accent-hover/40 hover:decoration-accent-hover cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
            onClick={() => {
              if (part.nodeId) openTab(focusedPaneId, part.nodeId);
            }}
            title={part.nodeId ? `Open ${part.mention}` : `${part.mention} (not found)`}
          >
            @{part.mention}
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
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
            {displayContent && <MentionText content={displayContent} />}
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
