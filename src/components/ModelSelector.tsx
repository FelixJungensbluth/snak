import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import { PROVIDER_LABELS, PROVIDER_MODELS } from "../providers";

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

  const handleSelect = useCallback(
    (model: string) => {
      if (!chat) return;
      updateModelConfig(
        chatId,
        defaultProvider,
        model,
        chat.temperature,
        chat.max_tokens
      );
      void persistConfig(defaultProvider, model);
      setOpen(false);
    },
    [chatId, chat, defaultProvider, updateModelConfig, persistConfig]
  );

  const providerModels = PROVIDER_MODELS[defaultProvider] || [];
  const fallbackModel = providerModels.includes(defaultModel)
    ? defaultModel
    : providerModels[0] || "";
  const activeModel = !chat
    ? fallbackModel
    : chat.provider === defaultProvider && providerModels.includes(chat.model)
      ? chat.model
      : fallbackModel || chat.model;
  const providerLabel = PROVIDER_LABELS[defaultProvider] || defaultProvider;

  // Provider is controlled in global settings; keep this chat aligned.
  useEffect(() => {
    if (!chat) return;
    if (
      chat.provider === defaultProvider &&
      chat.model === activeModel
    ) {
      return;
    }
    updateModelConfig(
      chatId,
      defaultProvider,
      activeModel,
      chat.temperature,
      chat.max_tokens
    );
    void persistConfig(defaultProvider, activeModel);
  }, [
    chat,
    chatId,
    activeModel,
    defaultProvider,
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
        <span className="truncate max-w-[220px]">{displayModel}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 z-50 bg-surface-raised border border-border-strong rounded shadow-xl py-1 min-w-[220px] max-h-[320px] overflow-y-auto">
          <div className="px-3 py-1 text-[10px] text-fg-dim uppercase tracking-wider">
            {providerLabel}
          </div>
          {providerModels.map((model) => (
            <button
              key={model}
              onClick={() => handleSelect(model)}
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
