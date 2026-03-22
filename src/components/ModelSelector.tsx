import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_MODELS } from "../providers";

interface ModelSelectorProps {
  chatId: string;
}

export default function ModelSelector({ chatId }: ModelSelectorProps) {
  const chat = useChatStore((s) => s.chats[chatId]);
  const updateModelConfig = useChatStore((s) => s.updateModelConfig);
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const defaultProvider = useSettingsStore((s) => s.defaultProvider);
  const defaultModel = useSettingsStore((s) => s.defaultModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const persistConfig = useCallback(
    async (provider: string, model: string) => {
      if (!rootPath) return;
      try {
        await invoke("update_chat_model_config", {
          workspaceRoot: rootPath,
          chatId,
          provider,
          model,
        });
      } catch (e) {
        console.error("Failed to persist chat model config:", e);
      }
    },
    [rootPath, chatId]
  );

  // Per-chat provider override: falls back to global default
  const chatProvider = chat?.provider || defaultProvider;

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
      const models = PROVIDER_MODELS[providerId] || [];
      const model = models[0] || "";
      updateModelConfig(
        chatId,
        providerId,
        model,
        chat.temperature,
        chat.max_tokens
      );
      void persistConfig(providerId, model);
    },
    [chatId, chat, updateModelConfig, persistConfig]
  );

  const providerModels = PROVIDER_MODELS[chatProvider] || [];
  const activeModel = !chat
    ? defaultModel
    : providerModels.includes(chat.model)
      ? chat.model
      : providerModels[0] || chat.model;
  const providerLabel = PROVIDER_LABELS[chatProvider] || chatProvider;

  // Sync model if provider changed externally
  useEffect(() => {
    if (!chat) return;
    if (chat.model === activeModel && chat.provider === chatProvider) return;
    updateModelConfig(
      chatId,
      chatProvider,
      activeModel,
      chat.temperature,
      chat.max_tokens
    );
    void persistConfig(chatProvider, activeModel);
  }, [
    chat,
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
        </div>
      )}
    </div>
  );
}
