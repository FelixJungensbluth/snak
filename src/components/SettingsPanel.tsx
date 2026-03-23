import { useCallback, useEffect, useRef, useState } from "react";
import { KeyRound, Check, Trash2, Globe, X, RotateCcw } from "lucide-react";
import * as api from "../api/workspace";
import { useSettingsStore, defaultShortcuts } from "../stores/settingsStore";
import { useUiStore } from "../stores/uiStore";
import { PROVIDERS, PROVIDER_MODELS } from "../providers";
import { THEMES } from "../themes";

export default function SettingsPanel() {
  const currentTheme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultTemperature = useSettingsStore((s) => s.defaultTemperature);
  const defaultMaxTokens = useSettingsStore((s) => s.defaultMaxTokens);
  const defaultSystemPrompt = useSettingsStore((s) => s.defaultSystemPrompt);
  const providers = useSettingsStore((s) => s.providers);
  const setDefaultProvider = useSettingsStore((s) => s.setDefaultProvider);
  const setDefaultModel = useSettingsStore((s) => s.setDefaultModel);
  const setDefaultTemperature = useSettingsStore((s) => s.setDefaultTemperature);
  const setDefaultMaxTokens = useSettingsStore((s) => s.setDefaultMaxTokens);
  const setDefaultSystemPrompt = useSettingsStore((s) => s.setDefaultSystemPrompt);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);

  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [ollamaUrl, setOllamaUrl] = useState(
    providers.ollama?.baseUrl || "http://localhost:11434"
  );

  // Load existing key status on mount
  useEffect(() => {
    for (const p of PROVIDERS) {
      if (!p.needsKey) continue;
      api.getApiKey(p.id).then((key) => {
        if (key) {
          setSaved((prev) => ({ ...prev, [p.id]: true }));
        }
      });
    }
  }, []);

  const handleSaveKey = useCallback(
    async (provider: string) => {
      const key = keys[provider]?.trim();
      if (!key) return;
      try {
        await api.setApiKey(provider, key);
        setProviderConfig(provider, { hasApiKey: true });
        setSaved((prev) => ({ ...prev, [provider]: true }));
        setKeys((prev) => ({ ...prev, [provider]: "" }));
      } catch (e) {
        console.error("Failed to save key:", e);
      }
    },
    [keys, setProviderConfig]
  );

  const handleDeleteKey = useCallback(
    async (provider: string) => {
      try {
        await api.deleteApiKey(provider);
        setProviderConfig(provider, { hasApiKey: false });
        setSaved((prev) => ({ ...prev, [provider]: false }));
      } catch (e) {
        console.error("Failed to delete key:", e);
      }
    },
    [setProviderConfig]
  );

  const handleSaveOllamaUrl = useCallback(() => {
    setProviderConfig("ollama", {
      baseUrl: ollamaUrl.trim() || "http://localhost:11434",
    });
  }, [ollamaUrl, setProviderConfig]);

  const handleProviderChange = useCallback(
    async (provider: string) => {
      setDefaultProvider(provider);
      if (provider === "ollama") {
        // Try to fetch live models from Ollama
        try {
          const baseUrl = providers.ollama?.baseUrl || null;
          const models = await api.listOllamaModels(baseUrl);
          if (models.length > 0) {
            setDefaultModel(models[0].name);
            return;
          }
        } catch {
          // Fall through to hardcoded list
        }
      }
      const models = PROVIDER_MODELS[provider] || [];
      if (models.length > 0) setDefaultModel(models[0]);
    },
    [setDefaultProvider, setDefaultModel, providers.ollama?.baseUrl]
  );

  const selectedProvider = PROVIDERS.find((p) => p.id === defaultProvider);
  const selectedProviderNeedsKey = selectedProvider?.needsKey ?? false;
  const selectedProviderId = selectedProvider?.id ?? defaultProvider;
  const selectedKey = keys[selectedProviderId] || "";
  const selectedSaved = saved[selectedProviderId] || false;

  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center px-4 h-[35px] border-b border-border shrink-0">
        <h1 className="text-xs font-medium text-fg flex-1">Settings</h1>
        <button
          onClick={() => setSettingsOpen(false)}
          className="p-1 text-fg-muted hover:text-fg hover:bg-surface-hover rounded transition-colors"
          title="Close settings"
        >
          <X size={14} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-[520px] mx-auto space-y-8">
          {/* ── Theme ──────────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
              Theme
            </h2>
            <div className="grid grid-cols-4 gap-1.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`group relative py-2 px-2 rounded text-xs text-center transition-colors ${
                    currentTheme === t.id
                      ? "ring-2 ring-accent"
                      : "border border-border hover:border-border-strong"
                  }`}
                  title={t.name}
                >
                  {/* Color preview dots */}
                  <div className="flex justify-center gap-1 mb-1.5">
                    <span
                      className="w-3 h-3 rounded-full border border-black/20"
                      style={{ background: t.colors.bg }}
                    />
                    <span
                      className="w-3 h-3 rounded-full border border-black/20"
                      style={{ background: t.colors.accent }}
                    />
                    <span
                      className="w-3 h-3 rounded-full border border-black/20"
                      style={{ background: t.colors.fg }}
                    />
                  </div>
                  <span className="text-fg-muted group-hover:text-fg text-[10px]">
                    {t.name}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* ── Provider ──────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
              Default Provider
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-fg-muted mb-1">
                  Provider
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleProviderChange(p.id)}
                      className={`py-1.5 px-2 rounded text-xs text-center transition-colors ${
                        defaultProvider === p.id
                          ? "bg-accent text-white"
                          : "bg-surface-raised text-fg-muted hover:bg-surface-hover hover:text-fg border border-border"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] text-fg-dim">
                  Model selection is configured per chat.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-fg-muted mb-1">
                    Temperature
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={defaultTemperature}
                    onChange={(e) =>
                      setDefaultTemperature(parseFloat(e.target.value) || 0)
                    }
                    className="w-full py-1.5 px-2 bg-surface-raised border border-border-strong rounded text-xs text-fg outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-fg-muted mb-1">
                    Max Tokens
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={200000}
                    step={256}
                    value={defaultMaxTokens}
                    onChange={(e) =>
                      setDefaultMaxTokens(parseInt(e.target.value) || 4096)
                    }
                    className="w-full py-1.5 px-2 bg-surface-raised border border-border-strong rounded text-xs text-fg outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── System Prompt ─────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
              System Prompt
            </h2>
            <label className="block text-[11px] text-fg-muted mb-1">
              Default system prompt for all chats
            </label>
            <textarea
              value={defaultSystemPrompt}
              onChange={(e) => setDefaultSystemPrompt(e.target.value)}
              placeholder="You are a helpful assistant..."
              rows={4}
              className="w-full py-1.5 px-2 bg-surface-raised border border-border-strong rounded text-xs text-fg placeholder-fg-dim outline-none focus:border-accent resize-y min-h-[60px] max-h-[200px]"
            />
            <p className="text-[10px] text-fg-dim mt-1">
              Applied to every chat as context for the model.
            </p>
          </section>

          {/* ── API Keys ──────────────────────────────────────────────── */}
          <section>
            <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
              API Keys
            </h2>
            <div>
              {selectedProviderNeedsKey ? (
                <div>
                  <label className="block text-[11px] text-fg-muted mb-1">
                    {selectedProvider?.label}
                    {selectedSaved && (
                      <span className="ml-1.5 text-green-500">
                        <Check size={10} className="inline" /> saved
                      </span>
                    )}
                  </label>
                  <div className="flex gap-1.5">
                    <div className="relative flex-1">
                      <KeyRound
                        size={11}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim"
                      />
                      <input
                        type="password"
                        value={selectedKey}
                        onChange={(e) =>
                          setKeys((prev) => ({
                            ...prev,
                            [selectedProviderId]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleSaveKey(selectedProviderId)
                        }
                        placeholder={
                          selectedSaved
                            ? "Replace existing key..."
                            : selectedProvider?.placeholder
                        }
                        className="w-full py-1.5 pl-6 pr-2 bg-surface-raised border border-border-strong rounded text-xs text-fg placeholder-fg-dim outline-none focus:border-accent"
                      />
                    </div>
                    <button
                      onClick={() => handleSaveKey(selectedProviderId)}
                      disabled={!selectedKey.trim()}
                      className="px-2.5 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-30 rounded text-xs text-white transition-colors"
                    >
                      Save
                    </button>
                    {selectedSaved && (
                      <button
                        onClick={() => handleDeleteKey(selectedProviderId)}
                        className="px-2 py-1.5 text-fg-error hover:bg-surface-hover rounded transition-colors"
                        title="Remove key"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-fg-dim">
                  {selectedProvider?.label} does not require an API key.
                </p>
              )}
            </div>
          </section>

          {/* ── Ollama ────────────────────────────────────────────────── */}
          {defaultProvider === "ollama" && <section>
            <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
              Ollama
            </h2>
            <label className="block text-[11px] text-fg-muted mb-1">
              Base URL
            </label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Globe
                  size={11}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-dim"
                />
                <input
                  type="text"
                  value={ollamaUrl}
                  onChange={(e) => setOllamaUrl(e.target.value)}
                  onBlur={handleSaveOllamaUrl}
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleSaveOllamaUrl()
                  }
                  placeholder="http://localhost:11434"
                  className="w-full py-1.5 pl-6 pr-2 bg-surface-raised border border-border-strong rounded text-xs text-fg placeholder-fg-dim outline-none focus:border-accent"
                />
              </div>
            </div>
            <p className="text-[10px] text-fg-dim mt-1">
              No API key needed. Make sure Ollama is running locally.
            </p>
          </section>}

          {/* ── Font Settings ──────────────────────────────────────────── */}
          <FontSettingsSection />

          {/* ── Keyboard Shortcuts ─────────────────────────────────────── */}
          <KeybindEditorSection />
        </div>
      </div>
    </div>
  );
}

/* ── Font families available in the dropdown ─────────────────────── */
const FONT_FAMILIES = [
  { value: "system-ui", label: "System Default" },
  { value: "Inter", label: "Inter" },
  { value: "-apple-system, BlinkMacSystemFont, 'SF Pro Text'", label: "SF Pro" },
  { value: "'JetBrains Mono'", label: "JetBrains Mono" },
  { value: "'Fira Sans'", label: "Fira Sans" },
  { value: "'IBM Plex Sans'", label: "IBM Plex Sans" },
  { value: "'Source Sans 3'", label: "Source Sans" },
  { value: "Georgia, serif", label: "Georgia" },
];

function FontSettingsSection() {
  const globalFontSize = useSettingsStore((s) => s.globalFontSize);
  const chatFontSize = useSettingsStore((s) => s.chatFontSize);
  const chatFontFamily = useSettingsStore((s) => s.chatFontFamily);
  const uiFontSize = useSettingsStore((s) => s.uiFontSize);
  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily);
  const setGlobalFontSize = useSettingsStore((s) => s.setGlobalFontSize);
  const setChatFontSize = useSettingsStore((s) => s.setChatFontSize);
  const setChatFontFamily = useSettingsStore((s) => s.setChatFontFamily);
  const setUiFontSize = useSettingsStore((s) => s.setUiFontSize);
  const setUiFontFamily = useSettingsStore((s) => s.setUiFontFamily);

  return (
    <section>
      <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
        Fonts
      </h2>
      <div className="space-y-4">
        {/* Global font size */}
        <div>
          <label className="block text-[11px] text-fg-muted mb-1">
            Global Font Size
          </label>
          <input
            type="number"
            min={10}
            max={24}
            step={1}
            value={globalFontSize}
            onChange={(e) => setGlobalFontSize(parseInt(e.target.value) || 13)}
            className="w-full py-1.5 px-2 bg-surface-raised border border-border-strong rounded text-xs text-fg outline-none focus:border-accent"
          />
          <p className="text-[10px] text-fg-dim mt-1">
            Scales the base font size for the entire app.
          </p>
        </div>

        {/* Chat font */}
        <div>
          <label className="block text-[11px] text-fg-muted mb-2">
            Chat Messages
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-fg-dim mb-1">Family</label>
              <select
                value={chatFontFamily}
                onChange={(e) => setChatFontFamily(e.target.value)}
                className="w-full py-1.5 px-2 bg-surface-raised border border-border-strong rounded text-xs text-fg outline-none focus:border-accent"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-fg-dim mb-1">
                Size ({chatFontSize}px)
              </label>
              <input
                type="range"
                min={10}
                max={24}
                step={1}
                value={chatFontSize}
                onChange={(e) => setChatFontSize(parseInt(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          </div>
          <p
            className="text-[11px] text-fg-dim mt-2 p-2 bg-surface rounded border border-border"
            style={{
              fontFamily: `${chatFontFamily}, -apple-system, BlinkMacSystemFont, sans-serif`,
              fontSize: `${chatFontSize}px`,
            }}
          >
            The quick brown fox jumps over the lazy dog.
          </p>
        </div>

        {/* UI font */}
        <div>
          <label className="block text-[11px] text-fg-muted mb-2">
            UI Chrome (sidebar, tabs, settings)
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-fg-dim mb-1">Family</label>
              <select
                value={uiFontFamily}
                onChange={(e) => setUiFontFamily(e.target.value)}
                className="w-full py-1.5 px-2 bg-surface-raised border border-border-strong rounded text-xs text-fg outline-none focus:border-accent"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-fg-dim mb-1">
                Size ({uiFontSize}px)
              </label>
              <input
                type="range"
                min={9}
                max={18}
                step={1}
                value={uiFontSize}
                onChange={(e) => setUiFontSize(parseInt(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          </div>
        </div>
        <p className="text-[10px] text-fg-dim">
          Code blocks always use a monospace font regardless of these settings.
        </p>
      </div>
    </section>
  );
}

/* ── Shortcut action labels ──────────────────────────────────────── */
const SHORTCUT_LABELS: Record<string, string> = {
  newChat: "New Chat",
  closeTab: "Close Tab",
  splitRight: "Split Right",
  openSettings: "Open Settings",
};

function KeybindEditorSection() {
  const shortcuts = useSettingsStore((s) => s.shortcuts);
  const setShortcut = useSettingsStore((s) => s.setShortcut);
  const resetShortcut = useSettingsStore((s) => s.resetShortcut);
  const [recording, setRecording] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-xs font-medium text-fg uppercase tracking-wider mb-4">
        Keyboard Shortcuts
      </h2>
      <div className="space-y-1">
        {Object.entries(shortcuts).map(([action, combo]) => (
          <div
            key={action}
            className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-surface-hover group"
          >
            <span className="text-xs text-fg">
              {SHORTCUT_LABELS[action] ?? action}
            </span>
            <div className="flex items-center gap-1.5">
              {recording === action ? (
                <KeyRecorder
                  onCapture={(newCombo) => {
                    setShortcut(action, newCombo);
                    setRecording(null);
                  }}
                  onCancel={() => setRecording(null)}
                />
              ) : (
                <button
                  onClick={() => setRecording(action)}
                  className="px-2 py-1 bg-surface-raised border border-border-strong rounded text-[11px] text-fg-muted hover:text-fg hover:border-accent transition-colors font-mono"
                  title="Click to rebind"
                >
                  {formatCombo(combo)}
                </button>
              )}
              {combo !== defaultShortcuts[action] && (
                <button
                  onClick={() => resetShortcut(action)}
                  className="p-1 text-fg-dim hover:text-fg rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="Reset to default"
                >
                  <RotateCcw size={11} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-fg-dim mt-3">
        Click a shortcut to rebind it. Press Escape to cancel.
      </p>
    </section>
  );
}

function KeyRecorder({
  onCapture,
  onCancel,
}: {
  onCapture: (combo: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      onCancel();
      return;
    }

    // Ignore bare modifier keys
    if (["Control", "Meta", "Alt", "Shift"].includes(e.key)) return;

    const parts: string[] = [];
    if (e.metaKey || e.ctrlKey) parts.push("CmdOrCtrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");

    // Normalize key name
    let key = e.key;
    if (key === " ") key = "Space";
    else if (key.length === 1) key = key.toUpperCase();
    parts.push(key);

    onCapture(parts.join("+"));
  }

  return (
    <span
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      className="px-2 py-1 bg-accent/20 border border-accent rounded text-[11px] text-accent animate-pulse font-mono outline-none"
    >
      Press a key…
    </span>
  );
}

function formatCombo(combo: string): string {
  const isMac = navigator.platform.includes("Mac");
  return combo
    .replace("CmdOrCtrl", isMac ? "⌘" : "Ctrl")
    .replace("Shift", isMac ? "⇧" : "Shift")
    .replace("Alt", isMac ? "⌥" : "Alt")
    .replace(/\+/g, isMac ? "" : "+");
}
