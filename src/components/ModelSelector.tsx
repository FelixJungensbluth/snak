import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useSettingsStore } from "../stores/settingsStore";
import * as api from "../api/workspace";
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_MODELS } from "../providers";

interface ModelSelectorProps {
  chatId: string;
}

export default function ModelSelector({ chatId }: ModelSelectorProps) {
  const chat = useChatStore((s) => s.chats[chatId]);
  const updateModelConfig = useChatStore((s) => s.updateModelConfig);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const ollamaBaseUrl = useSettingsStore((s) => s.providers.ollama?.baseUrl);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Live Ollama models
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  // Per-chat provider override: falls back to global default
  const chatProvider = chat?.provider || defaultProvider;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Fetch Ollama models when dropdown opens and Ollama is selected
  const fetchOllamaModels = useCallback(async () => {
    setOllamaLoading(true);
    setOllamaError(null);
    try {
      const models = await api.listOllamaModels(ollamaBaseUrl);
      setOllamaModels(models.map((m) => m.name));
    } catch (e) {
      setOllamaError(String(e));
      setOllamaModels([]);
    } finally {
      setOllamaLoading(false);
    }
  }, [ollamaBaseUrl]);

  useEffect(() => {
    if (open && chatProvider === "ollama") {
      fetchOllamaModels();
    }
  }, [open, chatProvider, fetchOllamaModels]);

  const persistConfig = useCallback(
    async (provider: string, model: string) => {
      try {
        await api.updateChatModelConfig(chatId, provider, model);
      } catch (e) {
        console.error("Failed to persist chat model config:", e);
      }
    },
    [chatId]
  );

  const handleSelectModel = useCallback(
    (model: string) => {
      if (!chat) return;
      updateModelConfig(
        chatId,
        chatProvider,
        model,
        chat.temperature,
        chat.max_tokens
      );
      void persistConfig(chatProvider, model);
      setOpen(false);
    },
    [chatId, chat, chatProvider, updateModelConfig, persistConfig]
  );

  const handleSelectProvider = useCallback(
    (providerId: string) => {
      if (!chat) return;
      // For Ollama, use the first live model if available, otherwise keep current
      const models = providerId === "ollama" && ollamaModels.length > 0
        ? ollamaModels
        : PROVIDER_MODELS[providerId] || [];
      const model = models[0] || chat.model;
      updateModelConfig(
        chatId,
        providerId,
        model,
        chat.temperature,
        chat.max_tokens
      );
      void persistConfig(providerId, model);
    },
    [chatId, chat, ollamaModels, updateModelConfig, persistConfig]
  );

  // Use live Ollama models when available, fall back to hardcoded list
  const providerModels = chatProvider === "ollama" && ollamaModels.length > 0
    ? ollamaModels
    : PROVIDER_MODELS[chatProvider] || [];

  const activeModel = !chat
    ? defaultModel
    : providerModels.includes(chat.model)
      ? chat.model
      : chat.model; // Keep the current model even if not in the list (it may still be valid)
  const providerLabel = PROVIDER_LABELS[chatProvider] || chatProvider;

  // Sync model if provider changed externally
  const chatModel = chat?.model;
  const chatTemp = chat?.temperature;
  const chatMaxTokens = chat?.max_tokens;
  const chatProviderStored = chat?.provider;
  useEffect(() => {
    if (!chat) return;
    if (chatModel === activeModel && chatProviderStored === chatProvider) return;
    updateModelConfig(
      chatId,
      chatProvider,
      activeModel,
      chatTemp ?? null,
      chatMaxTokens ?? null
    );
    void persistConfig(chatProvider, activeModel);
  }, [
    chatModel,
    chatProviderStored,
    chatTemp,
    chatMaxTokens,
    chatId,
    activeModel,
    chatProvider,
    updateModelConfig,
    persistConfig,
  ]);

  if (!chat) return null;

  // Short display name: strip provider prefix for openrouter models
  const displayModel = activeModel.includes("/")
    ? activeModel.split("/").pop()!
    : activeModel;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 py-0.5 text-[12px] text-fg-muted hover:text-fg transition-colors"
      >
        <span className="text-fg-dim">{providerLabel}</span>
        <span className="text-fg-dim">/</span>
        <span className="truncate max-w-[180px]">{displayModel}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-surface-raised border border-border-strong rounded shadow-xl py-1 min-w-[220px] max-h-[360px] overflow-y-auto">
          {/* Provider row */}
          <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border mb-1">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectProvider(p.id)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                  chatProvider === p.id
                    ? "bg-accent text-fg"
                    : "text-fg-muted hover:bg-surface-hover"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Ollama status */}
          {chatProvider === "ollama" && (
            <div className="px-3 py-1 border-b border-border mb-1 flex items-center gap-1.5">
              {ollamaLoading ? (
                <span className="text-[10px] text-fg-dim">Loading models…</span>
              ) : ollamaError ? (
                <span className="text-[10px] text-fg-error truncate flex-1">{ollamaError}</span>
              ) : (
                <span className="text-[10px] text-fg-dim">{ollamaModels.length} model{ollamaModels.length !== 1 ? "s" : ""} available</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); fetchOllamaModels(); }}
                className="text-fg-dim hover:text-fg transition-colors p-0.5"
                title="Refresh models"
              >
                <RefreshCw size={10} className={ollamaLoading ? "animate-spin" : ""} />
              </button>
            </div>
          )}

          {/* Model list */}
          {providerModels.map((model) => (
            <button
              key={model}
              onClick={() => handleSelectModel(model)}
              className={`w-full text-left px-3 py-1 text-xs hover:bg-accent-selection transition-colors ${
                activeModel === model
                  ? "text-accent-hover bg-accent-selection/50"
                  : "text-fg"
              }`}
            >
              {model}
            </button>
          ))}

          {/* Empty state for Ollama */}
          {chatProvider === "ollama" && !ollamaLoading && providerModels.length === 0 && !ollamaError && (
            <div className="px-3 py-2 text-[10px] text-fg-dim">
              No models found. Run <code className="bg-bg px-1 rounded">ollama pull &lt;model&gt;</code> to download one.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
