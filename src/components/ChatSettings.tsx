import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { useChatStore } from "../stores/chatStore";

interface ChatSettingsProps {
  chatId: string;
}

export default function ChatSettings({ chatId }: ChatSettingsProps) {
  const chat = useChatStore((s) => s.chats[chatId]);
  const updateModelConfig = useChatStore((s) => s.updateModelConfig);
  const [open, setOpen] = useState(false);

  if (!chat) return null;

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className={`p-1 rounded transition-colors ${
          open
            ? "text-fg bg-surface-hover"
            : "text-fg-dim hover:text-fg-muted"
        }`}
        title="Chat settings"
      >
        <SlidersHorizontal size={13} />
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-40 bg-surface-raised border border-border-strong rounded-lg shadow-2xl p-3 w-[220px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-fg-muted font-medium">
              Chat Settings
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-fg-dim hover:text-fg-muted"
            >
              <X size={11} />
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-[10px] text-fg-dim mb-0.5">
                Temperature
              </label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={chat.temperature ?? 1}
                onChange={(e) =>
                  updateModelConfig(
                    chatId,
                    chat.provider,
                    chat.model,
                    parseFloat(e.target.value),
                    chat.max_tokens
                  )
                }
                className="w-full h-1 accent-accent"
              />
              <div className="text-[10px] text-fg-dim text-right">
                {(chat.temperature ?? 1).toFixed(1)}
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-fg-dim mb-0.5">
                Max Tokens
              </label>
              <input
                type="number"
                min={1}
                max={200000}
                step={256}
                value={chat.max_tokens ?? 4096}
                onChange={(e) =>
                  updateModelConfig(
                    chatId,
                    chat.provider,
                    chat.model,
                    chat.temperature,
                    parseInt(e.target.value) || 4096
                  )
                }
                className="w-full py-1 px-2 bg-surface border border-border rounded text-xs text-fg outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
