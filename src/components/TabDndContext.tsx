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
import { Folder, MessageSquare } from "lucide-react";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { buildChildIndex } from "../utils/buildChildIndex";
import * as api from "../api/workspace";

// ── Drag data types ──────────────────────────────────────────────────────────

export interface TabDragData {
  type: "tab";
  chatId: string;
  sourcePaneId: string;
}

export interface SidebarDragData {
  type: "sidebar-node";
  nodeId: string;
  nodeType: "chat" | "folder";
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
  const setNodes = useWorkspaceStore((s) => s.setNodes);
  const splitPane = usePaneStore((s) => s.splitPane);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
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

      const overNode = nodes.find((n) => n.id === overId);
      if (overNode?.type === "folder" && overId !== activeDrag.nodeId) {
        setOverFolderId(overId);
      } else {
        setOverFolderId(null);
      }
    },
    [activeDrag, nodes]
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
          moveTab(drag.sourcePaneId, newPaneId, drag.chatId);
        } else if (drag.type === "sidebar-node" && drag.nodeType === "chat") {
          openTab(newPaneId, drag.nodeId);
        }
        return;
      }

      // ── Sidebar reorder / reparent ──────────────────────────────────────
      if (drag.type === "sidebar-node") {
        const draggedId = drag.nodeId;
        if (draggedId === dropId) return;

        const draggedNode = nodes.find((n) => n.id === draggedId);
        const overNode = nodes.find((n) => n.id === dropId);
        if (!draggedNode || !overNode) return;

        const childIndex = buildChildIndex(nodes);

        let targetParentId: string | null;
        let siblings: WorkspaceNode[];

        if (overNode.type === "folder" && currentOverFolderId === dropId) {
          // Reparent into folder
          targetParentId = dropId;
          siblings = [...(childIndex.get(dropId) ?? [])];
          const existingIdx = siblings.findIndex((n) => n.id === draggedId);
          if (existingIdx >= 0) siblings.splice(existingIdx, 1);
          siblings.unshift({ ...draggedNode, parent_id: targetParentId });
        } else {
          // Reorder among siblings
          targetParentId = overNode.parent_id;
          siblings = [...(childIndex.get(targetParentId) ?? [])];
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
    [activeDrag, overFolderId, nodes, splitPane, moveTab, openTab, setNodes, focusedPaneId]
  );

  const handleDragCancel = useCallback(() => {
    setActiveDrag(null);
    setOverFolderId(null);
  }, []);

  // Overlay label
  let overlayName: string | null = null;
  let overlayIcon: "chat" | "folder" = "chat";
  if (activeDrag) {
    if (activeDrag.type === "tab") {
      overlayName = nodes.find((n) => n.id === activeDrag.chatId)?.name ?? "Untitled";
    } else {
      const n = nodes.find((n) => n.id === activeDrag.nodeId);
      overlayName = n?.name ?? "Untitled";
      overlayIcon = n?.type === "folder" ? "folder" : "chat";
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
