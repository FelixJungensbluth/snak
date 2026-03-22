import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { applyTheme } from "../themes";

export interface ProviderConfig {
  /** API key is stored in OS keychain via Tauri — this is just a display flag */
  hasApiKey: boolean;
  baseUrl: string | null;
}

export interface SettingsState {
  /** Theme ID (e.g. "dark", "gruvbox-dark", "catppuccin-mocha", "nord") */
  theme: string;
  /** Default provider for new chats */
  defaultProvider: string;
  /** Default model for new chats */
  defaultModel: string;
  /** Default system prompt for new chats */
  defaultSystemPrompt: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  /** Map from provider id to provider config */
  providers: Record<string, ProviderConfig>;
  /** Keyboard shortcuts map: action → key combo */
  shortcuts: Record<string, string>;
}

export interface SettingsActions {
  setTheme: (themeId: string) => void;
  setDefaultProvider: (provider: string) => void;
  setDefaultModel: (model: string) => void;
  setDefaultSystemPrompt: (prompt: string) => void;
  setDefaultTemperature: (temperature: number) => void;
  setDefaultMaxTokens: (maxTokens: number) => void;
  setProviderConfig: (providerId: string, config: Partial<ProviderConfig>) => void;
  setShortcut: (action: string, keyCombo: string) => void;
}

const defaultShortcuts: Record<string, string> = {
  newChat: "CmdOrCtrl+N",
  closeTab: "CmdOrCtrl+W",
  splitRight: "CmdOrCtrl+\\",
  openSettings: "CmdOrCtrl+,",
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  immer((set) => ({
    theme: "dark",
    defaultProvider: "anthropic",
    defaultModel: "claude-sonnet-4-6",
    defaultSystemPrompt: "",
    defaultTemperature: 1.0,
    defaultMaxTokens: 4096,
    providers: {
      anthropic: { hasApiKey: false, baseUrl: null },
      openai: { hasApiKey: false, baseUrl: null },
      openrouter: { hasApiKey: false, baseUrl: null },
      ollama: { hasApiKey: false, baseUrl: "http://localhost:11434" },
    },
    shortcuts: defaultShortcuts,

    setTheme: (themeId) =>
      set((state) => {
        state.theme = themeId;
        applyTheme(themeId);
      }),

    setDefaultProvider: (provider) =>
      set((state) => {
        state.defaultProvider = provider;
      }),

    setDefaultModel: (model) =>
      set((state) => {
        state.defaultModel = model;
      }),

    setDefaultSystemPrompt: (prompt) =>
      set((state) => {
        state.defaultSystemPrompt = prompt;
      }),

    setDefaultTemperature: (temperature) =>
      set((state) => {
        state.defaultTemperature = temperature;
      }),

    setDefaultMaxTokens: (maxTokens) =>
      set((state) => {
        state.defaultMaxTokens = maxTokens;
      }),

    setProviderConfig: (providerId, config) =>
      set((state) => {
        const existing = state.providers[providerId] ?? {
          hasApiKey: false,
          baseUrl: null,
        };
        state.providers[providerId] = { ...existing, ...config };
      }),

    setShortcut: (action, keyCombo) =>
      set((state) => {
        state.shortcuts[action] = keyCombo;
      }),
  }))
);
