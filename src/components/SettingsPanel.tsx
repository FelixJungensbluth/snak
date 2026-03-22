import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, KeyRound, Check, Trash2, Globe } from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { PROVIDERS, PROVIDER_MODELS } from "../providers";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const {
    defaultProvider,
    defaultTemperature,
    defaultMaxTokens,
    defaultSystemPrompt,
    providers,
    setDefaultProvider,
    setDefaultModel,
    setDefaultTemperature,
    setDefaultMaxTokens,
    setDefaultSystemPrompt,
    setProviderConfig,
  } = useSettingsStore();

  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [ollamaUrl, setOllamaUrl] = useState(
    providers.ollama?.baseUrl || "http://localhost:11434"
  );

  // Load existing key status on mount
  useEffect(() => {
    for (const p of PROVIDERS) {
      if (!p.needsKey) continue;
      invoke<string | null>("get_api_key", { provider: p.id }).then((key) => {
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
        await invoke("set_api_key", { provider, apiKey: key });
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
        await invoke("delete_api_key", { provider });
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
    (provider: string) => {
      setDefaultProvider(provider);
      const models = PROVIDER_MODELS[provider] || [];
      if (models.length > 0) setDefaultModel(models[0]);
    },
    [setDefaultProvider, setDefaultModel]
  );

  const selectedProvider = PROVIDERS.find((p) => p.id === defaultProvider);
  const selectedProviderNeedsKey = selectedProvider?.needsKey ?? false;
  const selectedProviderId = selectedProvider?.id ?? defaultProvider;
  const selectedKey = keys[selectedProviderId] || "";
  const selectedSaved = saved[selectedProviderId] || false;

  return (
    <aside
      aria-hidden={!open}
      className={`h-full bg-surface border-l border-border overflow-hidden transition-all duration-200 ${
        open ? "w-[360px] opacity-100" : "w-0 opacity-0 pointer-events-none"
      }`}
    >
      <div className="flex flex-col h-full w-[360px]">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-border shrink-0">
        <button
          onClick={onClose}
          className="text-fg-muted hover:text-fg transition-colors"
        >
          <ArrowLeft size={15} />
        </button>
        <h1 className="text-sm font-medium text-fg">Settings</h1>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] mx-auto px-5 py-6 space-y-8">
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
        </div>
      </div>
      </div>
    </aside>
  );
}
