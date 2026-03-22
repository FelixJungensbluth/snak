import { createContext, useCallback, useContext, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { Folder, MessageSquare, FileText } from "lucide-react";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import * as api from "../api/workspace";

// ── Drag data types ──────────────────────────────────────────────────────────

export interface TabDragData {
  type: "tab";
  nodeId: string;
  sourcePaneId: string;
}

export interface SidebarDragData {
  type: "sidebar-node";
  nodeId: string;
  nodeType: "chat" | "folder" | "file";
}

export type DragData = TabDragData | SidebarDragData;

// ── Context ──────────────────────────────────────────────────────────────────

interface AppDndState {
  activeDrag: DragData | null;
  overFolderId: string | null;
}

const AppDndStateContext = createContext<AppDndState>({
  activeDrag: null,
  overFolderId: null,
});

export function useAppDndState() {
  return useContext(AppDndStateContext);
}

// Keep the old name as an alias for PaneView
export const useTabDndState = useAppDndState;

// ── Provider ─────────────────────────────────────────────────────────────────

export function TabDndProvider({ children }: { children: React.ReactNode }) {
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);

  const nodes = useWorkspaceStore((s) => s.nodes);
  const workspaceIndex = useWorkspaceStore((s) => s.index);
  const setNodes = useWorkspaceStore((s) => s.setNodes);
  const splitPane = usePaneStore((s) => s.splitPane);
  const openTab = useTabStore((s) => s.openTab);
  const moveTab = useTabStore((s) => s.moveTab);

  // Snapshot nodes before drag for rollback
  const nodesBeforeDrag = useRef<WorkspaceNode[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current as DragData | undefined;
      if (data) {
        setActiveDrag(data);
        nodesBeforeDrag.current = nodes;
      }
    },
    [nodes]
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (!over || !activeDrag) {
        setOverFolderId(null);
        return;
      }

      // Only handle sidebar node reordering/reparenting in drag-over
      if (activeDrag.type !== "sidebar-node") {
        setOverFolderId(null);
        return;
      }

      const overId = over.id as string;

      // If over a pane drop zone, clear folder highlight
      if (overId.startsWith("pane-drop:")) {
        setOverFolderId(null);
        return;
      }

      const overNode = workspaceIndex.byId.get(overId);
      if (overNode?.type === "folder" && overId !== activeDrag.nodeId) {
        setOverFolderId(overId);
      } else {
        setOverFolderId(null);
      }
    },
    [activeDrag, workspaceIndex]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const drag = activeDrag;
      const currentOverFolderId = overFolderId;
      setActiveDrag(null);
      setOverFolderId(null);

      if (!drag || !event.over) return;

      const dropId = event.over.id as string;

      // ── Drop on pane edge → split ───────────────────────────────────────
      if (dropId.startsWith("pane-drop:")) {
        const parts = dropId.split(":");
        const targetPaneId = parts[1];
        const direction = parts[2] as "left" | "right" | "top" | "bottom";
        const splitDirection =
          direction === "left" || direction === "right" ? "horizontal" : "vertical";
        const newPaneId = Math.random().toString(36).slice(2, 10);

        splitPane(targetPaneId, splitDirection, newPaneId);

        if (drag.type === "tab") {
          moveTab(drag.sourcePaneId, newPaneId, drag.nodeId);
        } else if (
          drag.type === "sidebar-node" &&
          (drag.nodeType === "chat" || drag.nodeType === "file")
        ) {
          openTab(newPaneId, drag.nodeId);
        }
        return;
      }

      // ── Sidebar reorder / reparent ──────────────────────────────────────
      if (drag.type === "sidebar-node") {
        const draggedId = drag.nodeId;
        if (draggedId === dropId) return;

        const draggedNode = workspaceIndex.byId.get(draggedId);
        const overNode = workspaceIndex.byId.get(dropId);
        if (!draggedNode || !overNode) return;

        let targetParentId: string | null;
        let siblings: WorkspaceNode[];

        if (overNode.type === "folder" && currentOverFolderId === dropId) {
          // Reparent into folder
          targetParentId = dropId;
          siblings = [...(workspaceIndex.childrenByParent.get(dropId) ?? [])];
          const existingIdx = siblings.findIndex((n) => n.id === draggedId);
          if (existingIdx >= 0) siblings.splice(existingIdx, 1);
          siblings.unshift({ ...draggedNode, parent_id: targetParentId });
        } else {
          // Reorder among siblings
          targetParentId = overNode.parent_id;
          siblings = [...(workspaceIndex.childrenByParent.get(targetParentId) ?? [])];
          const fromIdx = siblings.findIndex((n) => n.id === draggedId);
          if (fromIdx >= 0) siblings.splice(fromIdx, 1);
          const toIdx = siblings.findIndex((n) => n.id === dropId);
          if (toIdx >= 0) {
            siblings.splice(toIdx, 0, { ...draggedNode, parent_id: targetParentId });
          } else {
            siblings.push({ ...draggedNode, parent_id: targetParentId });
          }
        }

        const siblingIds = siblings.map((n) => n.id);

        // Optimistic update
        const updatedNodes = nodes.map((n) => {
          if (n.id === draggedId) {
            return { ...n, parent_id: targetParentId, order_idx: siblingIds.indexOf(n.id) };
          }
          const idx = siblingIds.indexOf(n.id);
          if (idx >= 0) return { ...n, order_idx: idx };
          return n;
        });
        setNodes(updatedNodes);

        try {
          await api.moveNode(draggedId, targetParentId, siblingIds);
        } catch (e) {
          console.error("move_node failed:", e);
          setNodes(nodesBeforeDrag.current);
        }
      }
    },
    [activeDrag, overFolderId, nodes, workspaceIndex, splitPane, moveTab, openTab, setNodes]
  );

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
    setOverFolderId(null);
  }, []);

  // Overlay label
  let overlayName: string | null = null;
  let overlayIcon: "chat" | "folder" | "file" = "chat";
  if (activeDrag) {
    if (activeDrag.type === "tab") {
      overlayName = workspaceIndex.byId.get(activeDrag.nodeId)?.name ?? "Untitled";
    } else {
      const n = workspaceIndex.byId.get(activeDrag.nodeId);
      overlayName = n?.name ?? "Untitled";
      overlayIcon = n?.type ?? "chat";
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <AppDndStateContext.Provider value={{ activeDrag, overFolderId }}>
        {children}
      </AppDndStateContext.Provider>
      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <div className="flex items-center gap-1.5 px-3 h-[28px] bg-surface-raised border border-border rounded shadow-lg text-xs text-fg opacity-90">
            {overlayIcon === "folder" ? (
              <Folder size={12} className="text-icon-folder" />
            ) : overlayIcon === "file" ? (
              <FileText size={12} className="text-fg-muted" />
            ) : (
              <MessageSquare size={12} className="text-icon-chat" />
            )}
            <span className="truncate max-w-[140px]">{overlayName}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
