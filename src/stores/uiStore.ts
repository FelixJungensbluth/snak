import { create } from "zustand";

interface UiState {
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  /** Chat finder overlay (Cmd+P) */
  chatFinderOpen: boolean;
  /** Opens the chat finder with a clean slate */
  openChatFinder: () => void;
  closeChatFinder: () => void;

  /** Content search overlay (Cmd+Shift+F) */
  contentSearchOpen: boolean;
  /** Opens the content search with a clean slate */
  openContentSearch: () => void;
  closeContentSearch: () => void;

  /** Command palette overlay (Cmd+K) */
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;

  /** Monotonically increasing counter — bumped on every overlay open so
   *  components can key on it to fully remount with fresh state. */
  overlayGeneration: number;

  /** When set, opening a chat should scroll to this message id */
  scrollToMessageId: string | null;
  setScrollToMessageId: (id: string | null) => void;

  /** Filter string for the sidebar file tree (client-side chat name filter) */
  sidebarFilter: string;
  setSidebarFilter: (filter: string) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  chatFinderOpen: false,
  openChatFinder: () =>
    set({
      chatFinderOpen: true,
      contentSearchOpen: false,
      sidebarFilter: "",
      overlayGeneration: get().overlayGeneration + 1,
    }),
  closeChatFinder: () => set({ chatFinderOpen: false, sidebarFilter: "" }),

  contentSearchOpen: false,
  openContentSearch: () =>
    set({
      contentSearchOpen: true,
      chatFinderOpen: false,
      commandPaletteOpen: false,
      overlayGeneration: get().overlayGeneration + 1,
    }),
  closeContentSearch: () => set({ contentSearchOpen: false }),

  commandPaletteOpen: false,
  openCommandPalette: () =>
    set({
      commandPaletteOpen: true,
      chatFinderOpen: false,
      contentSearchOpen: false,
      overlayGeneration: get().overlayGeneration + 1,
    }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),

  overlayGeneration: 0,

  scrollToMessageId: null,
  setScrollToMessageId: (id) => set({ scrollToMessageId: id }),
  sidebarFilter: "",
  setSidebarFilter: (filter) => set({ sidebarFilter: filter }),
}));
