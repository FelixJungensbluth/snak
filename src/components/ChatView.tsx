import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Send } from "lucide-react";
import { useChatStore, type Chat, type Message } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface ChatViewProps {
  chatId: string;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const chat = useChatStore((s) => s.chats[chatId]);
  const loadChat = useChatStore((s) => s.loadChat);
  const addMessage = useChatStore((s) => s.addMessage);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat from .md file if not already in store
  useEffect(() => {
    if (chat || !rootPath) return;
    setLoading(true);
    setError(null);
    invoke<{
      id: string;
      name: string;
      provider: string;
      model: string;
      messages: { role: string; content: string }[];
    }>("read_chat_file", { workspaceRoot: rootPath, chatId })
      .then((data) => {
        const messages: Message[] = data.messages.map((m, i) => ({
          id: `${chatId}-${i}`,
          role: m.role as Message["role"],
          content: m.content,
          attachments: [],
          created_at: Date.now(),
        }));
        const chatObj: Chat = {
          id: data.id,
          name: data.name,
          provider: data.provider,
          model: data.model,
          system_prompt: "",
          messages,
          streaming: false,
          streamBuffer: "",
          temperature: null,
          max_tokens: null,
          created_at: Date.now(),
          updated_at: Date.now(),
        };
        loadChat(chatObj);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [chatId, chat, rootPath, loadChat]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !rootPath) return;

    const userMsg: Message = {
      id: `${chatId}-${Date.now()}`,
      role: "user",
      content: text,
      attachments: [],
      created_at: Date.now(),
    };
    addMessage(chatId, userMsg);
    setInput("");

    // Persist to .md file
    try {
      await invoke("append_message_to_file", {
        workspaceRoot: rootPath,
        chatId,
        role: "user",
        content: text,
      });
    } catch (e) {
      console.error("Failed to persist message:", e);
    }

    // Placeholder assistant response
    const placeholderMsg: Message = {
      id: `${chatId}-${Date.now()}-assistant`,
      role: "assistant",
      content: "…",
      attachments: [],
      created_at: Date.now(),
    };
    addMessage(chatId, placeholderMsg);
  }, [input, chatId, rootPath, addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-fg-dim text-xs">
        Loading chat…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-fg-error text-xs">
        {error}
      </div>
    );
  }

  if (!chat) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {chat.messages.length === 0 && (
          <p className="text-xs text-fg-dim text-center mt-8">
            No messages yet. Start the conversation below.
          </p>
        )}
        {chat.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-surface">
        <div className="flex items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            className="flex-1 resize-none bg-transparent text-fg text-xs px-3 py-3 outline-none min-h-[80px] max-h-[200px]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="border-l border-border px-3 text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-stretch flex items-end pb-3"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[75%] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-accent text-fg"
            : isSystem
              ? "bg-surface-raised text-fg-muted italic"
              : "bg-surface-raised text-fg"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
