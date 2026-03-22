import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Send, Square } from "lucide-react";
import { useChatStore, type Chat, type Message } from "../stores/chatStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";
import ChatSettings from "./ChatSettings";
import ModelSelector from "./ModelSelector";
import MarkdownRenderer from "./MarkdownRenderer";

interface ChatViewProps {
  chatId: string;
}

export default function ChatView({ chatId }: ChatViewProps) {
  const chat = useChatStore((s) => s.chats[chatId]);
  const loadChat = useChatStore((s) => s.loadChat);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToken = useChatStore((s) => s.appendToken);
  const finalizeStream = useChatStore((s) => s.finalizeStream);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const rootPath = useWorkspaceStore((s) => s.rootPath);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

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

  // Scroll to bottom on new messages or streaming updates
  const streamBuffer = chat?.streamBuffer;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat?.messages.length, streamBuffer]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !rootPath || !chat) return;
    if (chat.streaming) return;

    setStreamError(null);

    const userMsg: Message = {
      id: `${chatId}-${Date.now()}`,
      role: "user",
      content: text,
      attachments: [],
      created_at: Date.now(),
    };
    addMessage(chatId, userMsg);
    setInput("");

    // Persist user message to .md file
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

    // Add a placeholder assistant message for streaming into
    const assistantMsg: Message = {
      id: `${chatId}-${Date.now()}-streaming`,
      role: "assistant",
      content: "",
      attachments: [],
      created_at: Date.now(),
    };
    addMessage(chatId, assistantMsg);
    setStreaming(chatId, true);

    // Build messages array for the API (all messages including the new user one)
    const apiMessages = [...chat.messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Set up event listeners before invoking
    const unlisteners: UnlistenFn[] = [];

    const onToken = await listen<{ chat_id: string; token: string }>(
      "stream-token",
      (event) => {
        if (event.payload.chat_id === chatId) {
          appendToken(chatId, event.payload.token);
        }
      }
    );
    unlisteners.push(onToken);

    const onDone = await listen<{ chat_id: string; full_text: string }>(
      "stream-done",
      async (event) => {
        if (event.payload.chat_id !== chatId) return;
        const msgId = `${chatId}-${Date.now()}-assistant`;
        finalizeStream(chatId, event.payload.full_text, msgId);

        // Persist the assistant response to .md file
        if (event.payload.full_text) {
          try {
            await invoke("append_message_to_file", {
              workspaceRoot: rootPath,
              chatId,
              role: "assistant",
              content: event.payload.full_text,
            });
          } catch (e) {
            console.error("Failed to persist assistant message:", e);
          }
        }

        // Clean up listeners
        unlisteners.forEach((fn) => fn());
      }
    );
    unlisteners.push(onDone);

    const onError = await listen<{ chat_id: string; error: string }>(
      "stream-error",
      (event) => {
        if (event.payload.chat_id !== chatId) return;
        setStreamError(event.payload.error);
        setStreaming(chatId, false);
        // Remove the empty placeholder if no tokens arrived
        const currentChat = useChatStore.getState().chats[chatId];
        if (currentChat) {
          const last = currentChat.messages[currentChat.messages.length - 1];
          if (last && last.role === "assistant" && !last.content) {
            // Remove empty placeholder by replacing messages
            useChatStore.setState((state) => {
              const c = state.chats[chatId];
              if (c) {
                c.messages = c.messages.filter((m) => m.id !== last.id);
              }
            });
          }
        }
        unlisteners.forEach((fn) => fn());
      }
    );
    unlisteners.push(onError);

    // Invoke the streaming command
    const ollamaUrl = useSettingsStore.getState().providers.ollama?.baseUrl || null;
    try {
      await invoke("stream_chat", {
        input: {
          chat_id: chatId,
          provider: chat.provider,
          model: chat.model,
          messages: apiMessages,
          system_prompt: chat.system_prompt || null,
          temperature: chat.temperature,
          max_tokens: chat.max_tokens,
          base_url: chat.provider === "ollama" ? ollamaUrl : null,
        },
      });
    } catch (e) {
      setStreamError(String(e));
      setStreaming(chatId, false);
      unlisteners.forEach((fn) => fn());
    }
  }, [input, chatId, rootPath, chat, addMessage, appendToken, finalizeStream, setStreaming]);

  const handleAbort = useCallback(async () => {
    try {
      await invoke("abort_stream", { chatId });
    } catch (e) {
      console.error("Failed to abort stream:", e);
    }
  }, [chatId]);

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
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={
              chat.streaming &&
              msg === chat.messages[chat.messages.length - 1] &&
              msg.role === "assistant"
            }
          />
        ))}
        {streamError && (
          <div className="flex justify-start">
            <div className="max-w-[75%] px-3 py-2 text-xs leading-relaxed bg-surface-raised text-fg-error">
              Error: {streamError}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-surface relative">
        <div className="flex items-center gap-2 px-3 pt-2">
          <ModelSelector chatId={chatId} />
          <ChatSettings chatId={chatId} />
        </div>
        <div className="flex items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            rows={1}
            disabled={chat.streaming}
            className="flex-1 resize-none bg-transparent text-fg text-xs px-3 py-3 outline-none min-h-[80px] max-h-[200px] disabled:opacity-50"
          />
          {chat.streaming ? (
            <button
              onClick={handleAbort}
              className="border-l border-border px-3 text-fg-error hover:text-fg transition-colors self-stretch flex items-end pb-3"
              title="Stop generation"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="border-l border-border px-3 text-fg-muted hover:text-fg disabled:opacity-30 disabled:cursor-not-allowed transition-colors self-stretch flex items-end pb-3"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
}: {
  message: Message;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const isAssistant = message.role === "assistant";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] px-3 py-2 text-xs leading-relaxed ${
          isUser
            ? "bg-accent text-fg whitespace-pre-wrap"
            : isSystem
              ? "bg-surface-raised text-fg-muted italic whitespace-pre-wrap"
              : "bg-surface-raised text-fg markdown-body"
        }`}
      >
        {isAssistant ? (
          <>
            <MarkdownRenderer content={message.content} />
            {isStreaming && <StreamingCursor />}
          </>
        ) : (
          <>
            {message.content}
            {isStreaming && <StreamingCursor />}
          </>
        )}
      </div>
    </div>
  );
});

function StreamingCursor() {
  return (
    <span className="inline-block w-[6px] h-[14px] bg-fg-muted ml-0.5 align-text-bottom animate-pulse" />
  );
}
