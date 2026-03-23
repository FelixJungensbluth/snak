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
  /** Global base font size (px) — scales the entire app */
  globalFontSize: number;
  /** Font size for chat messages (px) */
  chatFontSize: number;
  /** Font family for chat messages */
  chatFontFamily: string;
  /** Font size for UI chrome (sidebar, tabs, settings) (px) */
  uiFontSize: number;
  /** Font family for UI chrome */
  uiFontFamily: string;
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
  setGlobalFontSize: (size: number) => void;
  setChatFontSize: (size: number) => void;
  setChatFontFamily: (family: string) => void;
  setUiFontSize: (size: number) => void;
  setUiFontFamily: (family: string) => void;
  resetShortcut: (action: string) => void;
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
    globalFontSize: 13,
    chatFontSize: 13,
    chatFontFamily: "system-ui",
    uiFontSize: 12,
    uiFontFamily: "system-ui",

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

    setGlobalFontSize: (size) =>
      set((state) => {
        state.globalFontSize = size;
        applyFontSettings({ globalFontSize: size });
      }),

    setChatFontSize: (size) =>
      set((state) => {
        state.chatFontSize = size;
        applyFontSettings({ chatFontSize: size });
      }),

    setChatFontFamily: (family) =>
      set((state) => {
        state.chatFontFamily = family;
        applyFontSettings({ chatFontFamily: family });
      }),

    setUiFontSize: (size) =>
      set((state) => {
        state.uiFontSize = size;
        applyFontSettings({ uiFontSize: size });
      }),

    setUiFontFamily: (family) =>
      set((state) => {
        state.uiFontFamily = family;
        applyFontSettings({ uiFontFamily: family });
      }),

    resetShortcut: (action) =>
      set((state) => {
        if (defaultShortcuts[action]) {
          state.shortcuts[action] = defaultShortcuts[action];
        }
      }),
  }))
);

/** Apply font CSS custom properties to :root for instant updates */
export function applyFontSettings(partial?: Partial<Pick<SettingsState, "globalFontSize" | "chatFontSize" | "chatFontFamily" | "uiFontSize" | "uiFontFamily">>) {
  const s = partial
    ? { ...useSettingsStore.getState(), ...partial }
    : useSettingsStore.getState();
  const root = document.documentElement.style;
  root.setProperty("--global-font-size", `${s.globalFontSize}px`);
  root.setProperty("--chat-font-size", `${s.chatFontSize}px`);
  root.setProperty("--chat-font-family", s.chatFontFamily);
  root.setProperty("--ui-font-size", `${s.uiFontSize}px`);
  root.setProperty("--ui-font-family", s.uiFontFamily);
  // Apply global font size directly to <html>
  document.documentElement.style.fontSize = `${s.globalFontSize}px`;
}

export { defaultShortcuts };
