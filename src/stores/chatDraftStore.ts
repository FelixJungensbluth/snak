import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface ChatDraftState {
  drafts: Record<string, string>;
}

interface ChatDraftActions {
  setDraft: (chatId: string, value: string) => void;
  clearDraft: (chatId: string) => void;
}

export const useChatDraftStore = create<ChatDraftState & ChatDraftActions>()(
  immer((set) => ({
    drafts: {},

    setDraft: (chatId, value) =>
      set((state) => {
        state.drafts[chatId] = value;
      }),

    clearDraft: (chatId) =>
      set((state) => {
        delete state.drafts[chatId];
      }),
  })),
);
