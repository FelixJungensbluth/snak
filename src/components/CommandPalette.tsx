import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  FolderPlus,
  Search,
  Settings,
  MessageSquare,
  Columns2,
  FileDown,
  type LucideIcon,
} from "lucide-react";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useSettingsStore } from "../stores/settingsStore";
import * as api from "../api/workspace";

interface Command {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  section: string;
  action: () => void;
}

export default function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const generation = useUiStore((s) => s.overlayGeneration);
  if (!open) return null;
  return <CommandPaletteInner key={generation} />;
}

function CommandPaletteInner() {
  const close = useUiStore((s) => s.closeCommandPalette);
  const openChatFinder = useUiStore((s) => s.openChatFinder);
  const openContentSearch = useUiStore((s) => s.openContentSearch);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const splitPane = usePaneStore((s) => s.splitPane);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const upsertNode = useWorkspaceStore((s) => s.upsertNode);
  const chatNodes = useWorkspaceStore((s) => s.index.chatNodes);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);

  const [mode, setMode] = useState<"commands" | "arxiv">("commands");
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [arxivLoading, setArxivLoading] = useState(false);
  const [arxivError, setArxivError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const createChat = useCallback(async () => {
    if (!rootPath) return;
    try {
      const node = await api.createChat(defaultProvider, defaultModel);
      upsertNode(node);
      openTab(focusedPaneId, node.id);
    } catch (e) {
      console.error("create chat failed:", e);
    }
  }, [rootPath, defaultProvider, defaultModel, upsertNode, openTab, focusedPaneId]);

  const createFolder = useCallback(async () => {
    if (!rootPath) return;
    try {
      const node = await api.createFolder();
      upsertNode(node);
    } catch (e) {
      console.error("create folder failed:", e);
    }
  }, [rootPath, upsertNode]);

  const importArxiv = useCallback(async (url: string) => {
    if (!rootPath) return;
    setArxivLoading(true);
    setArxivError(null);
    try {
      const node = await api.importArxiv(url);
      upsertNode(node);
      openTab(focusedPaneId, node.id);
      close();
    } catch (e) {
      setArxivError(String(e));
    } finally {
      setArxivLoading(false);
    }
  }, [rootPath, upsertNode, openTab, focusedPaneId, close]);

  const isMac = navigator.platform.includes("Mac");
  const mod = isMac ? "⌘" : "Ctrl+";

  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [
      {
        id: "new-chat",
        label: "New Chat",
        icon: Plus,
        shortcut: `${mod}N`,
        section: "Actions",
        action: () => { close(); void createChat(); },
      },
      {
        id: "new-folder",
        label: "New Folder",
        icon: FolderPlus,
        section: "Actions",
        action: () => { close(); void createFolder(); },
      },
      {
        id: "find-chat",
        label: "Find Chat",
        icon: Search,
        shortcut: `${mod}P`,
        section: "Actions",
        action: () => { close(); openChatFinder(); },
      },
      {
        id: "search-content",
        label: "Search in Messages",
        icon: Search,
        shortcut: isMac ? "⌘⇧F" : "Ctrl+Shift+F",
        section: "Actions",
        action: () => { close(); openContentSearch(); },
      },
      {
        id: "split-pane",
        label: "Split Pane Right",
        icon: Columns2,
        shortcut: `${mod}\\`,
        section: "Actions",
        action: () => {
          close();
          const newId = Math.random().toString(36).slice(2, 10);
          splitPane(focusedPaneId, "horizontal", newId);
        },
      },
      {
        id: "import-arxiv",
        label: "Import ArXiv Paper",
        icon: FileDown,
        section: "Actions",
        action: () => { setMode("arxiv"); setQuery(""); setArxivError(null); },
      },
      {
        id: "settings",
        label: "Open Settings",
        icon: Settings,
        shortcut: `${mod},`,
        section: "Actions",
        action: () => { close(); setSettingsOpen(true); },
      },
    ];

    return cmds;
  }, [close, createChat, createFolder, openChatFinder, openContentSearch, setSettingsOpen, splitPane, focusedPaneId, mod, isMac]);

  // Build filtered list: commands + matching chats
  const filtered = useMemo(() => {
    const lower = query.toLowerCase().trim();
    const items: Array<{ type: "command"; command: Command } | { type: "chat"; node: WorkspaceNode }> = [];

    // Filter commands
    for (const cmd of commands) {
      if (!lower || cmd.label.toLowerCase().includes(lower)) {
        items.push({ type: "command", command: cmd });
      }
    }

    // If there's a query, also show matching chats
    if (lower) {
      const matchingChats = chatNodes
        .filter((n) => n.name.toLowerCase().includes(lower))
        .slice(0, 10);
      for (const node of matchingChats) {
        items.push({ type: "chat", node });
      }
    }

    return items;
  }, [commands, chatNodes, query]);

  const clampedIdx = Math.min(selectedIdx, Math.max(0, filtered.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = listRef.current?.children[clampedIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [clampedIdx]);

  function handleSelect(idx: number) {
    const item = filtered[idx];
    if (!item) return;
    if (item.type === "command") {
      item.command.action();
    } else {
      openTab(focusedPaneId, item.node.id);
      close();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(clampedIdx);
    }
  }

  // Group items by section for rendering
  let lastSection = "";

  if (mode === "arxiv") {
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
        <div className="absolute inset-0 bg-black/50" onClick={close} />
        <div className="relative w-[520px] max-w-[90vw] bg-surface-raised border border-border-strong rounded-lg shadow-2xl overflow-hidden flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <FileDown size={14} className="text-fg-muted flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setArxivError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMode("commands");
                  setQuery("");
                } else if (e.key === "Enter" && query.trim() && !arxivLoading) {
                  e.preventDefault();
                  void importArxiv(query.trim());
                }
              }}
              placeholder="Paste ArXiv URL or paper ID (e.g. 2301.07041)…"
              className="flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-fg-dim"
              spellCheck={false}
              disabled={arxivLoading}
            />
          </div>
          <div className="px-4 py-3">
            {arxivLoading && (
              <div className="text-xs text-fg-muted">Downloading paper…</div>
            )}
            {arxivError && (
              <div className="text-xs text-red-400">{arxivError}</div>
            )}
            {!arxivLoading && !arxivError && (
              <div className="text-xs text-fg-dim">
                Press Enter to download, Esc to go back
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      <div className="relative w-[520px] max-w-[90vw] bg-surface-raised border border-border-strong rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[50vh]">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <span className="text-fg-muted text-xs">{">"}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search…"
            className="flex-1 bg-transparent text-fg text-sm outline-none placeholder:text-fg-dim"
            spellCheck={false}
          />
        </div>

        {/* Results list */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-fg-dim text-xs">
              No results found
            </div>
          )}
          {filtered.map((item, idx) => {
            let sectionHeader: React.ReactNode = null;
            const section = item.type === "command" ? item.command.section : "Chats";
            if (section !== lastSection) {
              lastSection = section;
              sectionHeader = (
                <div className="px-3 pt-2 pb-1 text-[10px] text-fg-dim uppercase tracking-wider">
                  {section}
                </div>
              );
            }

            if (item.type === "command") {
              const Icon = item.command.icon;
              return (
                <div key={item.command.id}>
                  {sectionHeader}
                  <button
                    className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${
                      idx === clampedIdx ? "bg-accent-selection" : "hover:bg-surface-hover"
                    }`}
                    onClick={() => handleSelect(idx)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  >
                    <Icon size={14} className="text-fg-muted flex-shrink-0" />
                    <span className="flex-1 text-xs text-fg">{item.command.label}</span>
                    {item.command.shortcut && (
                      <kbd className="px-1.5 py-0.5 bg-surface rounded text-[10px] text-fg-dim font-mono">
                        {item.command.shortcut}
                      </kbd>
                    )}
                  </button>
                </div>
              );
            } else {
              return (
                <div key={item.node.id}>
                  {sectionHeader}
                  <CommandChatItem
                    node={item.node}
                    selected={idx === clampedIdx}
                    query={query}
                    onSelect={() => handleSelect(idx)}
                    onHover={() => setSelectedIdx(idx)}
                  />
                </div>
              );
            }
          })}
        </div>

        {/* Footer hints */}
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-fg-dim flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">↵</kbd> run
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-surface rounded text-[9px]">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

const CommandChatItem = memo(function CommandChatItem({
  node,
  selected,
  query,
  onSelect,
  onHover,
}: {
  node: WorkspaceNode;
  selected: boolean;
  query: string;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <button
      className={`w-full text-left px-3 py-2 flex items-center gap-2.5 ${
        selected ? "bg-accent-selection" : "hover:bg-surface-hover"
      }`}
      onClick={onSelect}
      onMouseEnter={onHover}
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
