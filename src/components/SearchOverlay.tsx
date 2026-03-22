import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, MessageSquare, X } from "lucide-react";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";

export default function ChatFinderOverlay() {
  const open = useUiStore((s) => s.chatFinderOpen);
  const generation = useUiStore((s) => s.overlayGeneration);
  if (!open) return null;
  return <ChatFinderInner key={generation} />;
}

function ChatFinderInner() {
  const close = useUiStore((s) => s.closeChatFinder);
  const setSidebarFilter = useUiStore((s) => s.setSidebarFilter);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const chats = useMemo(() => {
    const chatNodes = nodes.filter((n) => n.type === "chat");
    if (!query.trim()) return chatNodes;
    const lower = query.toLowerCase();
    return chatNodes.filter((n) => n.name.toLowerCase().includes(lower));
  }, [nodes, query]);

  const clampedIdx = Math.min(selectedIdx, Math.max(0, chats.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current?.children[clampedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIdx]);

  const handleSelect = useCallback(
    (chatId: string) => {
      openTab(focusedPaneId, chatId);
      close();
    },
    [openTab, focusedPaneId, close],
  );

  const handleHover = useCallback((idx: number) => {
    setSelectedIdx(idx);
  }, []);

  function handleQueryChange(value: string) {
    setQuery(value);
    setSelectedIdx(0);
    setSidebarFilter(value);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, chats.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (chats.length > 0) handleSelect(chats[clampedIdx].id);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      <div className="relative w-[480px] max-w-[90vw] bg-surface-raised border border-border-strong rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[50vh]">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <Search size={14} className="text-fg-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find chat…"
            className="flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-fg-dim"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => handleQueryChange("")}
              className="text-fg-dim hover:text-fg"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div ref={listRef} className="overflow-y-auto flex-1">
          {chats.length === 0 && (
            <div className="px-4 py-8 text-center text-fg-dim text-xs">
              {query.trim() ? `No chats matching "${query}"` : "No chats yet"}
            </div>
          )}
          {chats.map((node, idx) => (
            <ChatFinderItem
              key={node.id}
              node={node}
              idx={idx}
              selected={idx === clampedIdx}
              query={query}
              onSelect={handleSelect}
              onHover={handleHover}
            />
          ))}
        </div>

        {chats.length > 0 && (
          <div className="px-3 py-1.5 border-t border-border text-[10px] text-fg-dim flex items-center gap-3">
            <span>
              <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">
                ↑↓
              </kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">
                ↵
              </kbd>{" "}
              open
            </span>
            <span>
              <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">
                esc
              </kbd>{" "}
              close
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const ChatFinderItem = memo(function ChatFinderItem({
  node,
  idx,
  selected,
  query,
  onSelect,
  onHover,
}: {
  node: WorkspaceNode;
  idx: number;
  selected: boolean;
  query: string;
  onSelect: (chatId: string) => void;
  onHover: (idx: number) => void;
}) {
  return (
    <button
      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${
        selected ? "bg-accent-selection" : "hover:bg-surface-hover"
      }`}
      onClick={() => onSelect(node.id)}
      onMouseEnter={() => onHover(idx)}
    >
      <MessageSquare size={14} className="text-icon-chat flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-fg truncate">
          {highlightMatch(node.name, query)}
        </div>
        {node.last_message && (
          <div className="text-[10px] text-fg-dim truncate mt-0.5">
            {node.last_message}
          </div>
        )}
      </div>
    </button>
  );
});

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent/40 text-fg rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
