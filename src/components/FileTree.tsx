import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  MessageSquare,
  Pencil,
  Archive,
  Trash2,
} from "lucide-react";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useAppDndState, type SidebarDragData } from "./TabDndContext";

// ── Pre-indexed tree entry-point ─────────────────────────────────────────────

/** Map from parentId (null for root) to sorted children */
type ChildIndex = Map<string | null, WorkspaceNode[]>;

function buildChildIndex(nodes: WorkspaceNode[]): ChildIndex {
  const index: ChildIndex = new Map();
  for (const node of nodes) {
    const key = node.parent_id;
    let list = index.get(key);
    if (!list) {
      list = [];
      index.set(key, list);
    }
    list.push(node);
  }
  // Sort each group: folders first, then by order_idx
  for (const children of index.values()) {
    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.order_idx - b.order_idx;
    });
  }
  return index;
}

interface FileTreeProps {
  nodes: WorkspaceNode[];
  parentId: string | null;
  depth?: number;
}

export default function FileTree({ nodes, parentId, depth = 0 }: FileTreeProps) {
  const childIndex = useMemo(() => buildChildIndex(nodes), [nodes]);

  return (
    <FileTreeLevel childIndex={childIndex} parentId={parentId} depth={depth} />
  );
}

function FileTreeLevel({
  childIndex,
  parentId,
  depth,
}: {
  childIndex: ChildIndex;
  parentId: string | null;
  depth: number;
}) {
  const children = childIndex.get(parentId);
  if (!children || children.length === 0) return null;

  const ids = children.map((n) => n.id);

  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <ul className="list-none">
        {children.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            childIndex={childIndex}
            depth={depth}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

// ── Single tree node ──────────────────────────────────────────────────────────

function FileTreeNode({
  node,
  childIndex,
  depth,
}: {
  node: WorkspaceNode;
  childIndex: ChildIndex;
  depth: number;
}) {
  const isFolder = node.type === "folder";
  const { activeDrag, overFolderId } = useAppDndState();

  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const renameRef = useRef<HTMLInputElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const { rootPath, upsertNode, removeNode } = useWorkspaceStore();
  const openTab = useTabStore((s) => s.openTab);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);

  const dragData: SidebarDragData = {
    type: "sidebar-node",
    nodeId: node.id,
    nodeType: node.type,
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: node.id, data: dragData });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  useEffect(() => {
    if (renaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (!ctxMenuRef.current?.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  function startRename() {
    setCtxMenu(null);
    setRenameValue(node.name);
    setRenaming(true);
  }

  async function commitRename() {
    const trimmed = renameValue.trim();
    setRenaming(false);
    if (!trimmed || trimmed === node.name) {
      setRenameValue(node.name);
      return;
    }
    try {
      await invoke("rename_node", { workspaceRoot: rootPath, id: node.id, newName: trimmed });
      upsertNode({ ...node, name: trimmed });
    } catch (e) {
      console.error("rename_node failed:", e);
    }
  }

  function handleRenameKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") {
      setRenaming(false);
      setRenameValue(node.name);
    }
  }

  async function handleArchive() {
    setCtxMenu(null);
    try {
      await invoke("archive_node", { id: node.id });
      removeNode(node.id);
    } catch (e) {
      console.error("archive_node failed:", e);
    }
  }

  async function handleDelete() {
    setCtxMenu(null);
    if (!confirm(`Delete "${node.name}"?`)) return;
    try {
      await invoke("delete_node", { workspaceRoot: rootPath, id: node.id });
      removeNode(node.id);
    } catch (e) {
      console.error("delete_node failed:", e);
    }
  }

  const pl = 8 + depth * 16;
  const isActiveNode = activeDrag?.type === "sidebar-node" && activeDrag.nodeId === node.id;
  const isDropTarget = isFolder && overFolderId === node.id && !isActiveNode;

  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={`flex items-center h-[22px] cursor-pointer hover:bg-surface-hover select-none group ${
          isDropTarget ? "bg-accent-selection ring-1 ring-accent ring-inset" : ""
        }`}
        style={{ paddingLeft: `${pl}px` }}
        onClick={() => {
          if (isFolder) {
            setExpanded((p) => !p);
          } else {
            openTab(focusedPaneId, node.id);
          }
        }}
        onDoubleClick={startRename}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
        {...attributes}
        {...listeners}
      >
        {/* chevron */}
        <span className="w-4 flex items-center justify-center flex-shrink-0">
          {isFolder &&
            (expanded ? (
              <ChevronDown size={14} className="text-fg-muted" />
            ) : (
              <ChevronRight size={14} className="text-fg-muted" />
            ))}
        </span>

        {/* icon */}
        <span className="w-4 flex items-center justify-center flex-shrink-0 mr-1">
          {isFolder ? (
            <Folder size={14} className="text-icon-folder" />
          ) : (
            <MessageSquare size={14} className="text-icon-chat" />
          )}
        </span>

        {/* label or rename input */}
        {renaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleRenameKey}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-surface-raised text-fg text-xs rounded px-1 py-0 outline-none border border-accent"
          />
        ) : (
          <span className="flex-1 min-w-0 text-xs text-fg truncate">
            {node.name}
          </span>
        )}
      </div>

      {/* children */}
      {isFolder && expanded && (
        <FileTreeLevel childIndex={childIndex} parentId={node.id} depth={depth + 1} />
      )}

      {/* context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 bg-surface-raised border border-border-strong rounded shadow-xl py-0.5 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <CtxItem icon={<Pencil size={12} />} label="Rename" onClick={startRename} />
          <CtxItem icon={<Archive size={12} />} label="Archive" onClick={handleArchive} />
          <div className="my-0.5 border-t border-border-strong" />
          <CtxItem icon={<Trash2 size={12} />} label="Delete" onClick={handleDelete} danger />
        </div>
      )}
    </li>
  );
}

// ── Context menu item ─────────────────────────────────────────────────────────

function CtxItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      className={`w-full text-left px-3 py-1 text-xs flex items-center gap-2 hover:bg-accent-selection transition-colors ${
        danger ? "text-fg-error" : "text-fg"
      }`}
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
