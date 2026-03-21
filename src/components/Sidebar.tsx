import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, FolderPlus } from "lucide-react";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import FileTree from "./FileTree";

const MIN_WIDTH = 140;
const MAX_WIDTH = 480;

export default function Sidebar() {
  const { nodes, rootPath, upsertNode } = useWorkspaceStore();
  const [width, setWidth] = useState(208);
  const [creating, setCreating] = useState(false);
  const [bgCtxMenu, setBgCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const bgCtxRef = useRef<HTMLDivElement>(null);

  // ── resize logic ────────────────────────────────────────────────────────

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;

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
    },
    [width],
  );

  // ── create node via backend (server generates id + order_idx) ───────────

  async function createNode(nodeType: "chat" | "folder") {
    if (!rootPath || creating) return;
    setBgCtxMenu(null);
    setCreating(true);
    try {
      const node = await invoke<WorkspaceNode>(
        nodeType === "chat" ? "create_chat" : "create_folder",
        { workspaceRoot: rootPath },
      );
      upsertNode(node);
    } catch (e) {
      console.error(`create ${nodeType} failed:`, e);
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
      className="flex-shrink-0 bg-surface flex h-screen relative"
      style={{ width: `${width}px` }}
    >
      {/* scrollable tree area */}
      <div
        className="flex-1 overflow-y-auto py-1"
        onContextMenu={handleBgContext}
      >
        {nodes.length === 0 ? (
          <p className="text-[11px] text-fg-dim text-center mt-8 px-4">
            Right-click to create a chat
          </p>
        ) : (
          <FileTree nodes={nodes} parentId={null} />
        )}
      </div>

      {/* resize handle */}
      <div
        className="absolute top-0 right-0 w-[3px] h-full cursor-col-resize hover:bg-accent transition-colors z-10"
        onMouseDown={onResizeStart}
      />

      {/* background context menu */}
      {bgCtxMenu && (
        <div
          ref={bgCtxRef}
          className="fixed z-50 bg-surface-raised border border-border-strong rounded shadow-xl py-0.5 min-w-[150px]"
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
      className="w-full text-left px-3 py-1 text-xs flex items-center gap-2 text-fg hover:bg-accent-selection transition-colors"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );
}
