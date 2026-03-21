import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PaneNode } from "./paneStore";

export interface PaneScrollState {
  chatId: string;
  scrollTop: number;
}

export interface SessionState {
  /** Serialized pane layout — mirrors paneStore.root for persistence */
  paneLayout: PaneNode | null;
  /** Map from paneId to active chatId (mirrors tabStore) */
  activeTabs: Record<string, string | null>;
  /** Map from paneId to ordered list of open chatIds (mirrors tabStore) */
  openTabs: Record<string, string[]>;
  /** Map from chatId to scroll position */
  scrollPositions: Record<string, number>;
  /** Whether the session has been hydrated from disk */
  hydrated: boolean;
}

export interface SessionActions {
  setPaneLayout: (layout: PaneNode) => void;
  setActiveTabs: (activeTabs: Record<string, string | null>) => void;
  setOpenTabs: (openTabs: Record<string, string[]>) => void;
  setScrollPosition: (chatId: string, scrollTop: number) => void;
  setHydrated: (hydrated: boolean) => void;
  /** Snapshot current state for serialization */
  snapshot: () => Omit<SessionState, "hydrated">;
}

export const useSessionStore = create<SessionState & SessionActions>()(
  immer((set, get) => ({
    paneLayout: null,
    activeTabs: {},
    openTabs: {},
    scrollPositions: {},
    hydrated: false,

    setPaneLayout: (layout) =>
      set((state) => {
        state.paneLayout = layout;
      }),

    setActiveTabs: (activeTabs) =>
      set((state) => {
        state.activeTabs = activeTabs;
      }),

    setOpenTabs: (openTabs) =>
      set((state) => {
        state.openTabs = openTabs;
      }),

    setScrollPosition: (chatId, scrollTop) =>
      set((state) => {
        state.scrollPositions[chatId] = scrollTop;
      }),

    setHydrated: (hydrated) =>
      set((state) => {
        state.hydrated = hydrated;
      }),

    snapshot: () => {
      const { paneLayout, activeTabs, openTabs, scrollPositions } = get();
      return { paneLayout, activeTabs, openTabs, scrollPositions };
    },
  }))
);
