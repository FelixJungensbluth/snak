import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FilePlus2,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Pencil,
  Archive,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import * as api from "../api/workspace";
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
import { buildChildIndex, type ChildIndex } from "../utils/buildChildIndex";
import { getFileViewKind } from "../utils/fileNodes";

interface FileTreeProps {
  nodes: WorkspaceNode[];
  parentId: string | null;
  depth?: number;
  externalDropFolderId?: string | null;
}

export default function FileTree({
  nodes,
  parentId,
  depth = 0,
  externalDropFolderId = null,
}: FileTreeProps) {
  const childIndex = useMemo(() => buildChildIndex(nodes), [nodes]);

  return (
    <FileTreeLevel
      childIndex={childIndex}
      parentId={parentId}
      depth={depth}
      externalDropFolderId={externalDropFolderId}
    />
  );
}

function FileTreeLevel({
  childIndex,
  parentId,
  depth,
  externalDropFolderId,
}: {
  childIndex: ChildIndex;
  parentId: string | null;
  depth: number;
  externalDropFolderId: string | null;
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
            externalDropFolderId={externalDropFolderId}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

// ── Single tree node ──────────────────────────────────────────────────────────

const FileTreeNode = memo(function FileTreeNode({
  node,
  childIndex,
  depth,
  externalDropFolderId,
}: {
  node: WorkspaceNode;
  childIndex: ChildIndex;
  depth: number;
  externalDropFolderId: string | null;
}) {
  const isFolder = node.type === "folder";
  const { activeDrag, overFolderId } = useAppDndState();

  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(node.name);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  const renameRef = useRef<HTMLInputElement>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  const upsertNode = useWorkspaceStore((s) => s.upsertNode);
  const removeNode = useWorkspaceStore((s) => s.removeNode);
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
      await api.renameNode(node.id, trimmed);
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
      await api.archiveNode(node.id);
      removeNode(node.id);
    } catch (e) {
      console.error("archive_node failed:", e);
    }
  }

  async function handleDelete() {
    setCtxMenu(null);
    if (!confirm(`Delete "${node.name}"?`)) return;
    try {
      await api.deleteNode(node.id);
      removeNode(node.id);
    } catch (e) {
      console.error("delete_node failed:", e);
    }
  }

  const pl = 8 + depth * 16;
  const isActiveNode = activeDrag?.type === "sidebar-node" && activeDrag.nodeId === node.id;
  const isDropTarget =
    isFolder &&
    (overFolderId === node.id || externalDropFolderId === node.id) &&
    !isActiveNode;
  const fileKind = node.type === "file" ? getFileViewKind(node) : null;

  async function handleImportFiles() {
    setCtxMenu(null);
    if (!isFolder) return;

    const selected = await open({ multiple: true, directory: false });
    if (!selected) return;

    const paths = Array.isArray(selected) ? selected : [selected];
    await Promise.all(
      paths.map(async (path) => {
        try {
          const fileNode = await api.importFile(path, node.id);
          upsertNode(fileNode);
        } catch (e) {
          console.error("import_file failed:", e);
        }
      }),
    );
    setExpanded(true);
  }

  return (
    <li ref={setNodeRef} style={style}>
      <div
        data-folder-drop-id={isFolder ? node.id : undefined}
        className={`flex items-center h-[26px] cursor-pointer hover:bg-surface-hover/70 select-none group mx-1.5 rounded ${
          isDropTarget ? "bg-accent-selection ring-1 ring-accent ring-inset" : ""
        }`}
        style={{ paddingLeft: `${Math.max(pl - 6, 4)}px` }}
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
          ) : node.type === "file" ? (
            fileKind === "image" ? (
              <ImageIcon size={14} className="text-fg-muted" />
            ) : (
              <FileText size={14} className="text-fg-muted" />
            )
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
        <FileTreeLevel
          childIndex={childIndex}
          parentId={node.id}
          depth={depth + 1}
          externalDropFolderId={externalDropFolderId}
        />
      )}

      {/* context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 bg-surface-raised border border-border-strong rounded-lg shadow-2xl py-1 min-w-[140px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          {isFolder && (
            <CtxItem icon={<FilePlus2 size={12} />} label="Import Files" onClick={handleImportFiles} />
          )}
          {isFolder && <div className="mx-2 my-1 border-t border-border" />}
          <CtxItem icon={<Pencil size={12} />} label="Rename" onClick={startRename} />
          <CtxItem icon={<Archive size={12} />} label="Archive" onClick={handleArchive} />
          <div className="mx-2 my-1 border-t border-border" />
          <CtxItem icon={<Trash2 size={12} />} label="Delete" onClick={handleDelete} danger />
        </div>
      )}
    </li>
  );
});

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
      className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2.5 hover:bg-surface-hover rounded-md mx-0.5 transition-colors ${
        danger ? "text-fg-error" : "text-fg"
      }`}
      style={{ width: "calc(100% - 4px)" }}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <span className={danger ? "text-fg-error" : "text-fg-muted"}>{icon}</span>
      {label}
    </button>
  );
}
