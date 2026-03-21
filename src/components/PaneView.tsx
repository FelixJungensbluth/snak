import { useTabStore } from "../stores/tabStore";
import { usePaneStore } from "../stores/paneStore";
import TabBar from "./TabBar";
import ChatView from "./ChatView";

interface PaneViewProps {
  paneId: string;
}

export default function PaneView({ paneId }: PaneViewProps) {
  const paneTabs = useTabStore((s) => s.panes[paneId]);
  const setFocusedPane = usePaneStore((s) => s.setFocusedPane);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const activeChatId = paneTabs?.activeChatId ?? null;

  return (
    <div
      className={`flex flex-col h-full w-full ${
        focusedPaneId === paneId ? "" : ""
      }`}
      onClick={() => setFocusedPane(paneId)}
    >
      <TabBar paneId={paneId} />
      <div className="flex-1 overflow-hidden">
        {activeChatId ? (
          <ChatView chatId={activeChatId} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-fg-dim">Select or create a chat</p>
          </div>
        )}
      </div>
    </div>
  );
}
