import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, MessageSquare, X } from "lucide-react";
import * as api from "../api/workspace";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";

interface FtsResult {
  chat_id: string;
  msg_id: string;
  snippet: string;
}

interface ChatMatch {
  node: WorkspaceNode;
  results: FtsResult[];
}

export default function ContentSearchOverlay() {
  const open = useUiStore((s) => s.contentSearchOpen);
  const generation = useUiStore((s) => s.overlayGeneration);
  if (!open) return null;
  return <ContentSearchInner key={generation} />;
}

function ContentSearchInner() {
  const close = useUiStore((s) => s.closeContentSearch);
  const setScrollToMessageId = useUiStore((s) => s.setScrollToMessageId);
  const chatNodes = useWorkspaceStore((s) => s.index.chatNodes);
  const nodeById = useWorkspaceStore((s) => s.index.byId);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  // Input query — updates on every keystroke (only drives the <input>)
  const [query, setQuery] = useState("");
  // Settled query — updates only when FTS results arrive (drives list + preview)
  const [settledQuery, setSettledQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [ftsResults, setFtsResults] = useState<FtsResult[]>([]);
  const [previewMessages, setPreviewMessages] = useState<
    { role: string; content: string }[]
  >([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const previewCache = useRef(
    new Map<string, { role: string; content: string }[]>(),
  );

  // Items derived from settledQuery + ftsResults — stable between keystrokes
  const items: ChatMatch[] = useMemo(() => {
    if (!settledQuery) {
      return chatNodes.map((node) => ({ node, results: [] }));
    }
    const grouped = new Map<string, FtsResult[]>();
    for (const r of ftsResults) {
      let list = grouped.get(r.chat_id);
      if (!list) {
        list = [];
        grouped.set(r.chat_id, list);
      }
      list.push(r);
    }
    const result: ChatMatch[] = [];
    for (const [chatId, results] of grouped) {
      const node = nodeById.get(chatId);
      if (node) result.push({ node, results });
    }
    return result;
  }, [settledQuery, ftsResults, chatNodes, nodeById]);

  const clampedIdx = Math.min(selectedIdx, Math.max(0, items.length - 1));
  const selectedItem = items[clampedIdx] ?? null;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced FTS search
  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (!trimmed) {
      setFtsResults([]);
      setSettledQuery("");
      setSelectedIdx(0);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = (await api.searchMessages(trimmed, 50)) as FtsResult[];
        setFtsResults(results);
        setSettledQuery(trimmed);
        setSelectedIdx(0);
      } catch (e) {
        console.error("FTS search failed:", e);
        setFtsResults([]);
        setSettledQuery(trimmed);
        setSelectedIdx(0);
      }
    }, 80);
  }, []);

  // Load preview when selected chat changes — with cache
  useEffect(() => {
    if (!selectedItem || !rootPath) {
      setPreviewMessages([]);
      return;
    }
    const chatId = selectedItem.node.id;
    const cached = previewCache.current.get(chatId);
    if (cached) {
      setPreviewMessages(cached);
      return;
    }
    let cancelled = false;
    api.readChatFile(chatId)
      .then((data) => {
        if (!cancelled) {
          previewCache.current.set(chatId, data.messages);
          setPreviewMessages(data.messages);
        }
      })
      .catch((e) => {
        console.error("Failed to load chat preview:", e);
        if (!cancelled) setPreviewMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItem?.node.id, rootPath]);

  // Scroll to first match in preview
  useEffect(() => {
    if (!settledQuery || !previewRef.current) return;
    const frame = requestAnimationFrame(() => {
      const mark = previewRef.current?.querySelector(".content-search-match");
      mark?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [settledQuery, previewMessages]);

  // Scroll selected list item into view
  useEffect(() => {
    const el = listRef.current?.children[clampedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIdx]);

  // Stable callbacks for memoized children
  const handleSelect = useCallback(
    (nodeId: string, results: FtsResult[]) => {
      openTab(focusedPaneId, nodeId);
      if (results.length > 0) {
        setScrollToMessageId(results[0].msg_id);
      }
      close();
    },
    [openTab, focusedPaneId, setScrollToMessageId, close],
  );

  const handleHover = useCallback((idx: number) => {
    setSelectedIdx(idx);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedItem) {
        handleSelect(selectedItem.node.id, selectedItem.results);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]">
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      <div className="relative w-[900px] max-w-[95vw] h-[70vh] bg-surface-raised border border-border-strong rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border flex-shrink-0">
          <Search size={14} className="text-fg-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              doSearch(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search message content…"
            className="flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-fg-dim"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                doSearch("");
              }}
              className="text-fg-dim hover:text-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Two-panel body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div
            ref={listRef}
            className="w-[280px] flex-shrink-0 border-r border-border overflow-y-auto"
          >
            {items.length === 0 && settledQuery && (
              <div className="px-4 py-8 text-center text-fg-dim text-xs">
                No messages matching "{settledQuery}"
              </div>
            )}
            {items.length === 0 && !settledQuery && (
              <div className="px-4 py-8 text-center text-fg-dim text-xs">
                No chats yet
              </div>
            )}
            {items.map((item, idx) => (
              <ChatListItem
                key={item.node.id}
                item={item}
                idx={idx}
                selected={idx === clampedIdx}
                onSelect={handleSelect}
                onHover={handleHover}
              />
            ))}
          </div>

          {/* Right panel */}
          <div
            ref={previewRef}
            className="flex-1 overflow-y-auto px-4 py-3 bg-bg"
          >
            {!selectedItem && (
              <div className="flex items-center justify-center h-full text-fg-dim text-xs">
                Select a chat to preview
              </div>
            )}

            {selectedItem && previewMessages.length === 0 && (
              <div className="flex items-center justify-center h-full text-fg-dim text-xs">
                No messages in this chat
              </div>
            )}

            {selectedItem &&
              previewMessages.map((msg, i) => (
                <PreviewMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  query={settledQuery}
                />
              ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-fg-dim flex items-center gap-3 flex-shrink-0">
          <span>
            <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">
              ↑↓
            </kbd>{" "}
            navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">↵</kbd>{" "}
            open
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Memoized sub-components ---------- */

const ChatListItem = memo(function ChatListItem({
  item,
  idx,
  selected,
  onSelect,
  onHover,
}: {
  item: ChatMatch;
  idx: number;
  selected: boolean;
  onSelect: (nodeId: string, results: FtsResult[]) => void;
  onHover: (idx: number) => void;
}) {
  return (
    <button
      className={`w-full text-left px-3 py-2 flex items-center gap-2 ${
        selected ? "bg-accent-selection" : "hover:bg-surface-hover"
      }`}
      onClick={() => onSelect(item.node.id, item.results)}
      onMouseEnter={() => onHover(idx)}
    >
      <MessageSquare size={14} className="text-icon-chat flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-fg truncate">{item.node.name}</div>
        {item.node.last_message && (
          <div className="text-[10px] text-fg-dim truncate mt-0.5">
            {item.node.last_message}
          </div>
        )}
      </div>
    </button>
  );
});

const PreviewMessage = memo(function PreviewMessage({
  role,
  content,
  query,
}: {
  role: string;
  content: string;
  query: string;
}) {
  // When searching, skip messages that don't match
  if (query && !content.toLowerCase().includes(query.toLowerCase())) {
    return null;
  }

  return (
    <div className={`mb-3 ${role === "user" ? "text-right" : ""}`}>
      <div
        className={`inline-block max-w-[90%] px-3 py-2 text-xs leading-relaxed ${
          role === "user"
            ? "bg-accent text-fg"
            : "bg-surface-raised text-fg"
        }`}
      >
        <div className="text-[10px] text-fg-muted mb-1 font-medium">
          {role}
        </div>
        {query ? (
          <HighlightedContent content={content} query={query} />
        ) : (
          <div className="whitespace-pre-wrap break-words">
            {content.length > 500 ? content.slice(0, 500) + "…" : content}
          </div>
        )}
      </div>
    </div>
  );
});

const HighlightedContent = memo(function HighlightedContent({
  content,
  query,
}: {
  content: string;
  query: string;
}) {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();

  const matches: number[] = [];
  let pos = 0;
  while (pos < lowerContent.length && matches.length < 10) {
    const idx = lowerContent.indexOf(lowerQuery, pos);
    if (idx < 0) break;
    matches.push(idx);
    pos = idx + lowerQuery.length;
  }

  if (matches.length === 0) {
    return (
      <div className="whitespace-pre-wrap break-words">
        {content.length > 500 ? content.slice(0, 500) + "…" : content}
      </div>
    );
  }

  const CONTEXT = 60;
  const fragments: React.ReactNode[] = [];
  let lastEnd = 0;

  for (let i = 0; i < matches.length; i++) {
    const matchStart = matches[i];
    const matchEnd = matchStart + query.length;
    const fragStart = Math.max(lastEnd, matchStart - CONTEXT);

    if (fragStart > lastEnd && lastEnd > 0) {
      fragments.push(
        <span key={`e-${i}`} className="text-fg-dim">
          {" … "}
        </span>,
      );
    } else if (fragStart > 0 && i === 0) {
      fragments.push(
        <span key="es" className="text-fg-dim">
          {"… "}
        </span>,
      );
    }

    if (fragStart < matchStart) {
      fragments.push(
        <span key={`p-${i}`}>{content.slice(fragStart, matchStart)}</span>,
      );
    }

    fragments.push(
      <mark
        key={`m-${i}`}
        className="content-search-match bg-accent/50 text-fg rounded-sm px-0.5"
      >
        {content.slice(matchStart, matchEnd)}
      </mark>,
    );

    const afterEnd = Math.min(
      content.length,
      matchEnd + CONTEXT,
      i + 1 < matches.length ? matches[i + 1] : content.length,
    );
    if (matchEnd < afterEnd) {
      fragments.push(
        <span key={`a-${i}`}>{content.slice(matchEnd, afterEnd)}</span>,
      );
    }
    lastEnd = afterEnd;
  }

  if (lastEnd < content.length) {
    fragments.push(
      <span key="ee" className="text-fg-dim">
        {" …"}
      </span>,
    );
  }

  return <div className="whitespace-pre-wrap break-words">{fragments}</div>;
});
