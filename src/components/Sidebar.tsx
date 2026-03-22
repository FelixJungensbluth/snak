import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, FolderPlus, Sparkles, Settings } from "lucide-react";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useUiStore } from "../stores/uiStore";
import FileTree from "./FileTree";
import { seedDemoChat } from "../seedDemo";

const MIN_WIDTH = 140;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { nodes, rootPath, upsertNode } = useWorkspaceStore();
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const sidebarFilter = useUiStore((s) => s.sidebarFilter);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [width, setWidth] = useState(208);

  // Filter nodes by chat name when sidebar filter is active
  const filteredNodes = useMemo(() => {
    if (!sidebarFilter.trim()) return nodes;
    const lower = sidebarFilter.toLowerCase();
    // Keep chats that match and all folders (to preserve hierarchy)
    const matchingChatIds = new Set(
      nodes
        .filter((n) => n.type === "chat" && n.name.toLowerCase().includes(lower))
        .map((n) => n.id)
    );
    // Also keep folders that are ancestors of matching chats
    const keepIds = new Set(matchingChatIds);
    for (const chatId of matchingChatIds) {
      let node = nodes.find((n) => n.id === chatId);
      while (node?.parent_id) {
        keepIds.add(node.parent_id);
        node = nodes.find((n) => n.id === node!.parent_id);
      }
    }
    return nodes.filter((n) => keepIds.has(n.id));
  }, [nodes, sidebarFilter]);
  const [creating, setCreating] = useState(false);
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const bgCtxRef = useRef<HTMLDivElement>(null);

  // ── resize logic ────────────────────────────────────────────────────────

  const widthRef = useRef(width);
  widthRef.current = width;

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;

    const onMove = (ev: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW + ev.clientX - startX));
      setWidth(next);
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // ── create node via backend (server generates id + order_idx) ───────────

  async function createNode(nodeType: "chat" | "folder") {
    if (!rootPath || creating) return;
    setBgCtxMenu(null);
    setCreating(true);
    try {
      const node =
        nodeType === "chat"
          ? await invoke<WorkspaceNode>("create_chat", {
              workspaceRoot: rootPath,
              provider: defaultProvider,
              model: defaultModel,
            })
          : await invoke<WorkspaceNode>("create_folder", {
              workspaceRoot: rootPath,
            });
      upsertNode(node);
      if (nodeType === "chat") {
        openTab(focusedPaneId, node.id);
      }
    } catch (e) {
      console.error(`create ${nodeType} failed:`, e);
    } finally {
      setCreating(false);
    }
  }

  // ── seed demo chat ─────────────────────────────────────────────────────
  async function createDemoChat() {
    if (!rootPath || creating) return;
    setBgCtxMenu(null);
    setCreating(true);
    try {
      const result = await seedDemoChat(rootPath);
      upsertNode({
        id: result.id,
        type: "chat" as const,
        name: result.name,
        parent_id: result.parent_id,
        order_idx: result.order_idx,
        is_archived: result.is_archived,
        provider: result.provider,
        model: result.model,
        last_message: result.last_message,
      });
      openTab(focusedPaneId, result.id);
    } catch (e) {
      console.error("create demo chat failed:", e);
    } finally {
      setCreating(false);
    }
  }

  // ── background right-click (empty area) ─────────────────────────────────

  function handleBgContext(e: React.MouseEvent) {
    e.preventDefault();
    setBgCtxMenu({ x: e.clientX, y: e.clientY });

    const close = (ev: MouseEvent) => {
      if (!bgCtxRef.current?.contains(ev.target as Node)) {
        setBgCtxMenu(null);
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <aside
      className="flex-shrink-0 bg-surface flex flex-col h-screen relative border-r border-border"
      style={{ width: `${width}px` }}
    >
      {/* section header */}
      <div className="px-3 pt-3 pb-2">
        <span className="text-[10px] text-fg-dim/70 uppercase tracking-wider font-medium">Chats</span>
      </div>

      {/* scrollable tree area */}
      <div
        className="flex-1 overflow-y-auto pb-2"
        onContextMenu={handleBgContext}
      >
        {filteredNodes.length === 0 && sidebarFilter.trim() ? (
          <p className="text-[10px] text-fg-dim/60 text-center mt-6 px-4">
            No chats matching "{sidebarFilter}"
          </p>
        ) : filteredNodes.length === 0 ? (
          <p className="text-[10px] text-fg-dim/60 text-center mt-6 px-4">
            Right-click to create a chat
          </p>
        ) : (
          <FileTree nodes={filteredNodes} parentId={null} />
        )}
      </div>

      {/* settings button */}
      <div className="border-t border-border px-2 py-1.5">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-[11px] rounded-md transition-colors ${
            settingsOpen
              ? "text-fg bg-surface-hover"
              : "text-fg-dim hover:text-fg hover:bg-surface-hover/70"
          }`}
        >
          <Settings size={13} />
          <span>Settings</span>
        </button>
      </div>

      {/* resize handle */}
      <div
        className="absolute top-0 right-[-2px] w-[5px] h-full cursor-col-resize hover:bg-accent/50 transition-colors z-10"
        onMouseDown={onResizeStart}
      />

      {/* background context menu */}
      {bgCtxMenu && (
        <div
          ref={bgCtxRef}
          className="fixed z-50 bg-surface-raised border border-border-strong rounded-lg shadow-2xl py-1 min-w-[150px]"
          style={{ left: bgCtxMenu.x, top: bgCtxMenu.y }}
        >
          <BgCtxItem
            icon={<Plus size={12} />}
            label="New Chat"
            onClick={() => createNode("chat")}
          />
          <BgCtxItem
            icon={<FolderPlus size={12} />}
            label="New Folder"
            onClick={() => createNode("folder")}
          />
          <div className="border-t border-border mx-2 my-1" />
          <BgCtxItem
            icon={<Sparkles size={12} />}
            label="Create Demo Chat"
            onClick={createDemoChat}
          />
        </div>
      )}
    </aside>
  );
}

function BgCtxItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2.5 text-fg hover:bg-surface-hover rounded-md mx-0.5 transition-colors"
      style={{ width: "calc(100% - 4px)" }}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <span className="text-fg-muted">{icon}</span>
      {label}
    </button>
  );
}
