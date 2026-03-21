import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceStore, WorkspaceNode } from "../stores/workspaceStore";

// ── Icons ────────────────────────────────────────────────────────────────────

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
      {open ? (
        <path d="M1.5 3A1.5 1.5 0 000 4.5v8A1.5 1.5 0 001.5 14h13a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H7.621a1.5 1.5 0 01-1.06-.44L5.5 3H1.5z" />
      ) : (
        <path d="M.54 3.87L.5 4a2 2 0 00-2 2l-.5 5a2 2 0 002 2H14a2 2 0 002-2l-.5-5a2 2 0 00-2-2H8.5l-.5-1H1.5a1 1 0 00-.96.87zM1.5 3H5l.5 1H1.5a.5.5 0 000 1H14a.5.5 0 01.485.379L15 10a.5.5 0 01-.5.621H1.5A.5.5 0 011 10L1.5 5a.5.5 0 01.5-.5V3z" />
      )}
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" fill="currentColor">
      <path d="M14 1H2a1 1 0 00-1 1v8a1 1 0 001 1h2v2.5L7 11h7a1 1 0 001-1V2a1 1 0 00-1-1z" />
    </svg>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  x: number;
  y: number;
  nodeId: string;
  nodeType: "chat" | "folder";
}

function ContextMenu({
  menu,
  onRename,
  onArchive,
  onDelete,
  onClose,
}: {
  menu: ContextMenuState;
  onRename: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const item = (label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      onClick={() => { onClick(); onClose(); }}
      className={`w-full rounded px-3 py-1.5 text-left text-sm hover:bg-zinc-700 ${danger ? "text-red-400" : "text-zinc-200"}`}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ top: menu.y, left: menu.x }}
      className="fixed z-50 min-w-[140px] rounded-lg border border-zinc-700 bg-zinc-800 p-1 shadow-xl"
    >
      {item("Rename", () => onRename(menu.nodeId))}
      {item("Archive", () => onArchive(menu.nodeId))}
      {item("Delete", () => onDelete(menu.nodeId), true)}
    </div>
  );
}

// ── Tree node row ─────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: WorkspaceNode;
  depth: number;
  children: WorkspaceNode[];
  allNodes: WorkspaceNode[];
  onContextMenu: (e: React.MouseEvent, node: WorkspaceNode) => void;
  editingId: string | null;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, name: string) => void;
}

function TreeNode({
  node,
  depth,
  allNodes,
  onContextMenu,
  editingId,
  onStartEdit,
  onCommitEdit,
}: TreeNodeProps) {
  const [open, setOpen] = useState(true);
  const [editValue, setEditValue] = useState(node.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFolder = node.type === "folder";
  const isEditing = editingId === node.id;

  const directChildren = allNodes.filter((n) => n.parent_id === node.id);

  useEffect(() => {
    if (isEditing) {
      setEditValue(node.name);
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [isEditing, node.name]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") onCommitEdit(node.id, editValue);
    if (e.key === "Escape") onCommitEdit(node.id, node.name);
  }

  return (
    <li>
      <div
        className="group flex items-center gap-1 rounded px-2 py-1 text-sm text-zinc-300 hover:bg-zinc-800 cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => isFolder && setOpen((o) => !o)}
        onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, node); }}
        onDoubleClick={() => !isFolder && onStartEdit(node.id)}
      >
        <span className="text-zinc-500">
          {isFolder ? <FolderIcon open={open} /> : <ChatIcon />}
        </span>

        {isEditing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => onCommitEdit(node.id, editValue)}
            className="flex-1 rounded bg-zinc-700 px-1 py-0.5 text-sm outline-none ring-1 ring-indigo-500"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="flex-1 truncate"
            onDoubleClick={(e) => { e.stopPropagation(); onStartEdit(node.id); }}
          >
            {node.name}
          </span>
        )}
      </div>

      {isFolder && open && directChildren.length > 0 && (
        <ul>
          {directChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              children={allNodes.filter((n) => n.parent_id === child.id)}
              allNodes={allNodes}
              onContextMenu={onContextMenu}
              editingId={editingId}
              onStartEdit={onStartEdit}
              onCommitEdit={onCommitEdit}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar() {
  const { nodes, rootPath, setNodes, upsertNode, removeNode } = useWorkspaceStore();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load nodes on mount / when workspace changes
  useEffect(() => {
    if (!rootPath) return;
    invoke<WorkspaceNode[]>("list_nodes")
      .then(setNodes)
      .catch((e) => setError(String(e)));
  }, [rootPath, setNodes]);

  const rootNodes = nodes.filter((n) => n.parent_id === null);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function handleNewChat() {
    if (!rootPath) return;
    try {
      const node = await invoke<WorkspaceNode>("create_chat", { workspaceRoot: rootPath });
      upsertNode(node);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleNewFolder() {
    if (!rootPath) return;
    try {
      const node = await invoke<WorkspaceNode>("create_folder", { workspaceRoot: rootPath });
      upsertNode(node);
    } catch (e) {
      setError(String(e));
    }
  }

  function handleContextMenu(e: React.MouseEvent, node: WorkspaceNode) {
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id, nodeType: node.type });
  }

  function handleStartEdit(id: string) {
    setEditingId(id);
    setContextMenu(null);
  }

  async function handleCommitEdit(id: string, newName: string) {
    setEditingId(null);
    const node = nodes.find((n) => n.id === id);
    if (!node || newName === node.name || !newName.trim()) return;
    try {
      await invoke("rename_node", { id, newName: newName.trim() });
      upsertNode({ ...node, name: newName.trim() });
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleArchive(id: string) {
    try {
      await invoke("archive_node", { id });
      removeNode(id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(id: string) {
    if (!rootPath) return;
    try {
      await invoke("delete_node", { workspaceRoot: rootPath, id });
      removeNode(id);
      // Also remove any children that were cascade-deleted
      const allChildIds = collectDescendants(id, nodes);
      allChildIds.forEach(removeNode);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Workspace</span>
        <div className="flex gap-1">
          <button
            onClick={handleNewFolder}
            title="New Folder"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M9.828 3h3.982a2 2 0 011.992 2.181L15 10l-.028.287A1 1 0 0114 11H2a1 1 0 01-.972-.757L1 10V6a2 2 0 012-2h4.172a2 2 0 011.414.586l.828.828A2 2 0 009.828 6H14a1 1 0 00-1-1H9.828zM8 7.5a.5.5 0 01.5.5v1h1a.5.5 0 010 1h-1v1a.5.5 0 01-1 0v-1h-1a.5.5 0 010-1h1v-1A.5.5 0 018 7.5z" />
            </svg>
          </button>
          <button
            onClick={handleNewChat}
            title="New Chat"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 15A7 7 0 108 1a7 7 0 000 14zm.5-10a.5.5 0 00-1 0v3h-3a.5.5 0 000 1h3v3a.5.5 0 001 0v-3h3a.5.5 0 000-1h-3V5z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {error && (
          <p className="mx-3 my-2 rounded bg-red-900/30 px-2 py-1 text-xs text-red-400">{error}</p>
        )}
        <ul>
          {rootNodes.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              children={nodes.filter((n) => n.parent_id === node.id)}
              allNodes={nodes}
              onContextMenu={handleContextMenu}
              editingId={editingId}
              onStartEdit={handleStartEdit}
              onCommitEdit={handleCommitEdit}
            />
          ))}
        </ul>
        {rootNodes.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-zinc-600">
            No chats yet.
            <br />
            Click + to create one.
          </p>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onRename={handleStartEdit}
          onArchive={handleArchive}
          onDelete={handleDelete}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectDescendants(id: string, nodes: WorkspaceNode[]): string[] {
  const direct = nodes.filter((n) => n.parent_id === id).map((n) => n.id);
  return direct.flatMap((childId) => [childId, ...collectDescendants(childId, nodes)]);
}
