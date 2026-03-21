import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export interface PaneTabs {
  /** Ordered list of chat IDs open in this pane */
  chatIds: string[];
  /** Which chat is currently active (or null if pane is empty) */
  activeChatId: string | null;
}

export interface TabState {
  /** Map from paneId to tab state */
  panes: Record<string, PaneTabs>;
}

export interface TabActions {
  openTab: (paneId: string, chatId: string) => void;
  closeTab: (paneId: string, chatId: string) => void;
  setActiveTab: (paneId: string, chatId: string) => void;
  moveTab: (fromPaneId: string, toPaneId: string, chatId: string) => void;
  closeOtherTabs: (paneId: string, chatId: string) => void;
  closeTabsToRight: (paneId: string, chatId: string) => void;
}

export const useTabStore = create<TabState & TabActions>()(
  immer((set) => ({
    panes: {},

    openTab: (paneId, chatId) =>
      set((state) => {
        if (!state.panes[paneId]) {
          state.panes[paneId] = { chatIds: [], activeChatId: null };
        }
        const pane = state.panes[paneId];
        if (!pane.chatIds.includes(chatId)) {
          pane.chatIds.push(chatId);
        }
        pane.activeChatId = chatId;
      }),

    closeTab: (paneId, chatId) =>
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return;
        pane.chatIds = pane.chatIds.filter((id) => id !== chatId);
        if (pane.activeChatId === chatId) {
          pane.activeChatId = pane.chatIds[pane.chatIds.length - 1] ?? null;
        }
      }),

    setActiveTab: (paneId, chatId) =>
      set((state) => {
        if (state.panes[paneId]) {
          state.panes[paneId].activeChatId = chatId;
        }
      }),

    moveTab: (fromPaneId, toPaneId, chatId) =>
      set((state) => {
        const from = state.panes[fromPaneId];
        if (!from) return;
        from.chatIds = from.chatIds.filter((id) => id !== chatId);
        if (from.activeChatId === chatId) {
          from.activeChatId = from.chatIds[from.chatIds.length - 1] ?? null;
        }

        if (!state.panes[toPaneId]) {
          state.panes[toPaneId] = { chatIds: [], activeChatId: null };
        }
        const to = state.panes[toPaneId];
        if (!to.chatIds.includes(chatId)) {
          to.chatIds.push(chatId);
        }
        to.activeChatId = chatId;
      }),

    closeOtherTabs: (paneId, chatId) =>
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return;
        pane.chatIds = [chatId];
        pane.activeChatId = chatId;
      }),

    closeTabsToRight: (paneId, chatId) =>
      set((state) => {
        const pane = state.panes[paneId];
        if (!pane) return;
        const idx = pane.chatIds.indexOf(chatId);
        if (idx < 0) return;
        pane.chatIds = pane.chatIds.slice(0, idx + 1);
        if (
          pane.activeChatId !== null &&
          !pane.chatIds.includes(pane.activeChatId)
        ) {
          pane.activeChatId = chatId;
        }
      }),
  }))
);
