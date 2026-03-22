import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface PaneTabs {
  /** Ordered list of node IDs open in this pane */
  nodeIds: string[];
  /** Which node is currently active (or null if pane is empty) */
  activeNodeId: string | null;
}

export interface TabState {
  /** Map from paneId to tab state */
  panes: Record<string, PaneTabs>;
}

export interface TabActions {
  openTab: (paneId: string, nodeId: string) => void;
  closeTab: (paneId: string, nodeId: string) => void;
  setActiveTab: (paneId: string, nodeId: string) => void;
  moveTab: (fromPaneId: string, toPaneId: string, nodeId: string) => void;
  closeOtherTabs: (paneId: string, nodeId: string) => void;
  closeTabsToRight: (paneId: string, nodeId: string) => void;
}

export const useTabStore = create<TabState & TabActions>()(
  immer((set) => ({
    panes: {},

    openTab: (paneId, nodeId) =>
      set((state) => {
        if (!state.panes[paneId]) {
          state.panes[paneId] = { nodeIds: [], activeNodeId: null };
        }
        const pane = state.panes[paneId];
        if (!pane.nodeIds.includes(nodeId)) {
          pane.nodeIds.push(nodeId);
        }
        pane.activeNodeId = nodeId;
      }),

    closeTab: (paneId, nodeId) =>
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return;
        pane.nodeIds = pane.nodeIds.filter((id) => id !== nodeId);
        if (pane.activeNodeId === nodeId) {
          pane.activeNodeId = pane.nodeIds[pane.nodeIds.length - 1] ?? null;
        }
      }),

    setActiveTab: (paneId, nodeId) =>
      set((state) => {
        if (state.panes[paneId]) {
          state.panes[paneId].activeNodeId = nodeId;
        }
      }),

    moveTab: (fromPaneId, toPaneId, nodeId) =>
      set((state) => {
        const from = state.panes[fromPaneId];
        if (!from) return;
        from.nodeIds = from.nodeIds.filter((id) => id !== nodeId);
        if (from.activeNodeId === nodeId) {
          from.activeNodeId = from.nodeIds[from.nodeIds.length - 1] ?? null;
        }

        if (!state.panes[toPaneId]) {
          state.panes[toPaneId] = { nodeIds: [], activeNodeId: null };
        }
        const to = state.panes[toPaneId];
        if (!to.nodeIds.includes(nodeId)) {
          to.nodeIds.push(nodeId);
        }
        to.activeNodeId = nodeId;
      }),

    closeOtherTabs: (paneId, nodeId) =>
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return;
        pane.nodeIds = [nodeId];
        pane.activeNodeId = nodeId;
      }),

    closeTabsToRight: (paneId, nodeId) =>
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return;
        const idx = pane.nodeIds.indexOf(nodeId);
        if (idx < 0) return;
        pane.nodeIds = pane.nodeIds.slice(0, idx + 1);
        if (
          pane.activeNodeId !== null &&
          !pane.nodeIds.includes(pane.activeNodeId)
        ) {
          pane.activeNodeId = nodeId;
        }
      }),
  }))
);
