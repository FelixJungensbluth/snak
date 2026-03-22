import { useCallback } from "react";
import { Plus, X } from "lucide-react";
import * as api from "../api/workspace";
import { useDroppable } from "@dnd-kit/core";
import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useTabDndState } from "./TabDndContext";
import TabBar from "./TabBar";
import ChatView from "./ChatView";

interface PaneViewProps {
  paneId: string;
}

export default function PaneView({ paneId }: PaneViewProps) {
  const paneTabs = useTabStore((s) => s.panes[paneId]);
  const openTab = useTabStore((s) => s.openTab);
  const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
  const closePane = usePaneStore((s) => s.closePane);
  const hasMultiplePanes = usePaneStore((s) => s.root.kind === "split");
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const upsertNode = useWorkspaceStore((s) => s.upsertNode);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const activeChatId = paneTabs?.activeChatId ?? null;
  const { activeDrag } = useTabDndState();

  const showDropZones = activeDrag !== null;

  const handleNewChat = useCallback(async () => {
    if (!rootPath) return;
    try {
      const node = await api.createChat(defaultProvider, defaultModel);
      upsertNode(node);
      openTab(paneId, node.id);
    } catch (e) {
      console.error("create chat failed:", e);
    }
  }, [rootPath, defaultProvider, defaultModel, upsertNode, openTab, paneId]);

  return (
    <div
      className="flex flex-col h-full w-full relative"
      onClick={() => setFocusedPane(paneId)}
    >
      <div className="relative">
        <TabBar paneId={paneId} isFocused={hasMultiplePanes && focusedPaneId === paneId} />
        {hasMultiplePanes && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              closePane(paneId);
            }}
            className="absolute top-1 right-1 p-0.5 text-fg-muted hover:text-fg hover:bg-surface-hover rounded transition-colors z-10"
            title="Close pane"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {activeChatId ? (
          <ChatView chatId={activeChatId} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <button
              onClick={handleNewChat}
              className="flex items-center gap-2 px-4 py-2 text-xs text-fg bg-surface-raised hover:bg-surface-hover border border-border rounded transition-colors"
            >
              <Plus size={14} />
              New Chat
            </button>
            <p className="text-[10px] text-fg-dim">or select a chat from the sidebar</p>
          </div>
        )}
      </div>

      {/* Directional drop zones - shown when dragging a tab */}
      {showDropZones && (
        <>
          <PaneDropZone paneId={paneId} direction="left" />
          <PaneDropZone paneId={paneId} direction="right" />
          <PaneDropZone paneId={paneId} direction="top" />
          <PaneDropZone paneId={paneId} direction="bottom" />
        </>
      )}
    </div>
  );
}

function PaneDropZone({
  paneId,
  direction,
}: {
  paneId: string;
  direction: "left" | "right" | "top" | "bottom";
}) {
  const id = `pane-drop:${paneId}:${direction}`;
  const { isOver, setNodeRef } = useDroppable({ id });

  const positionClasses: Record<string, string> = {
    left: "left-0 top-0 w-1/2 h-full",
    right: "right-0 top-0 w-1/2 h-full",
    top: "left-0 top-0 w-full h-1/2",
    bottom: "left-0 bottom-0 w-full h-1/2",
  };

  return (
    <div
      ref={setNodeRef}
      className={`absolute z-20 pointer-events-auto transition-colors ${positionClasses[direction]} ${
        isOver ? "bg-accent/20 border-2 border-accent border-dashed" : ""
      }`}
    />
  );
}
