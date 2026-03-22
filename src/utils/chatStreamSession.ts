import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface StreamTokenEvent {
  chat_id: string;
  token: string;
}

interface StreamDoneEvent {
  chat_id: string;
  full_text: string;
}

interface StreamErrorEvent {
  chat_id: string;
  error: string;
}

interface ChatStreamSessionOptions {
  chatId: string;
  onToken: (token: string) => void;
  onDone: (fullText: string) => void | Promise<void>;
  onError: (error: string) => void | Promise<void>;
}

export interface ChatStreamSession {
  dispose: () => void;
}

export async function createChatStreamSession(
  options: ChatStreamSessionOptions,
): Promise<ChatStreamSession> {
  const unlisteners: UnlistenFn[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let bufferedToken = "";
  let closed = false;

  const flushBufferedToken = () => {
    if (!bufferedToken) return;
    const token = bufferedToken;
    bufferedToken = "";
    options.onToken(token);
  };

  const clearFlushTimer = () => {
    if (!flushTimer) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const closeSession = () => {
    if (closed) return;
    closed = true;
    clearFlushTimer();
    flushBufferedToken();
    while (unlisteners.length > 0) {
      const unlisten = unlisteners.pop();
      unlisten?.();
    }
  };

  const scheduleFlush = () => {
    if (closed || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushBufferedToken();
    }, 16);
  };

  const onToken = await listen<StreamTokenEvent>("stream-token", (event) => {
    if (closed || event.payload.chat_id !== options.chatId) return;
    bufferedToken += event.payload.token;
    scheduleFlush();
  });
  unlisteners.push(onToken);

  const onDone = await listen<StreamDoneEvent>("stream-done", async (event) => {
    if (closed || event.payload.chat_id !== options.chatId) return;
    closeSession();
    await options.onDone(event.payload.full_text);
  });
  unlisteners.push(onDone);

  const onError = await listen<StreamErrorEvent>("stream-error", async (event) => {
    if (closed || event.payload.chat_id !== options.chatId) return;
    closeSession();
    await options.onError(event.payload.error);
  });
  unlisteners.push(onError);

  return {
    dispose: closeSession,
  };
}
