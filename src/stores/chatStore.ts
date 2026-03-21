import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export type MessageRole = "user" | "assistant" | "system";

export interface Attachment {
  type: "image" | "pdf" | "markdown";
  /** Path relative to workspace root */
  path: string;
  name: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  attachments: Attachment[];
  /** Unix timestamp ms */
  created_at: number;
}

export interface Chat {
  id: string;
  /** Display name / filename stem */
  name: string;
  provider: string;
  model: string;
  system_prompt: string;
  messages: Message[];
  /** True while a response is streaming */
  streaming: boolean;
  /** Partial token accumulation during streaming */
  streamBuffer: string;
  temperature: number | null;
  max_tokens: number | null;
  created_at: number;
  updated_at: number;
}

export interface ChatState {
  /** Map from chatId to chat state */
  chats: Record<string, Chat>;
}

export interface ChatActions {
  loadChat: (chat: Chat) => void;
  unloadChat: (chatId: string) => void;
  addMessage: (chatId: string, message: Message) => void;
  appendToken: (chatId: string, token: string) => void;
  finalizeStream: (chatId: string, finalContent: string, msgId: string) => void;
  setStreaming: (chatId: string, streaming: boolean) => void;
  updateSystemPrompt: (chatId: string, systemPrompt: string) => void;
  renameChat: (chatId: string, name: string) => void;
  updateModelConfig: (
    chatId: string,
    provider: string,
    model: string,
    temperature: number | null,
    maxTokens: number | null
  ) => void;
}

export const useChatStore = create<ChatState & ChatActions>()(
  immer((set) => ({
    chats: {},

    loadChat: (chat) =>
      set((state) => {
        state.chats[chat.id] = chat;
      }),

    unloadChat: (chatId) =>
      set((state) => {
        delete state.chats[chatId];
      }),

    addMessage: (chatId, message) =>
      set((state) => {
        state.chats[chatId]?.messages.push(message);
      }),

    appendToken: (chatId, token) =>
      set((state) => {
        const chat = state.chats[chatId];
        if (!chat) return;
        chat.streamBuffer += token;
      }),

    finalizeStream: (chatId, finalContent, msgId) =>
      set((state) => {
        const chat = state.chats[chatId];
        if (!chat) return;
        chat.messages.push({
          id: msgId,
          role: "assistant",
          content: finalContent,
          attachments: [],
          created_at: Date.now(),
        });
        chat.streamBuffer = "";
        chat.streaming = false;
        chat.updated_at = Date.now();
      }),

    setStreaming: (chatId, streaming) =>
      set((state) => {
        const chat = state.chats[chatId];
        if (!chat) return;
        chat.streaming = streaming;
        if (streaming) chat.streamBuffer = "";
      }),

    updateSystemPrompt: (chatId, systemPrompt) =>
      set((state) => {
        const chat = state.chats[chatId];
        if (!chat) return;
        chat.system_prompt = systemPrompt;
      }),

    renameChat: (chatId, name) =>
      set((state) => {
        const chat = state.chats[chatId];
        if (!chat) return;
        chat.name = name;
      }),

    updateModelConfig: (chatId, provider, model, temperature, maxTokens) =>
      set((state) => {
        const chat = state.chats[chatId];
        if (!chat) return;
        chat.provider = provider;
        chat.model = model;
        chat.temperature = temperature;
        chat.max_tokens = maxTokens;
      }),
  }))
);
