import { X, MessageSquare } from "lucide-react";
import { useTabStore } from "../stores/tabStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface TabBarProps {
  paneId: string;
}

export default function TabBar({ paneId }: TabBarProps) {
  const paneTabs = useTabStore((s) => s.panes[paneId]);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const nodes = useWorkspaceStore((s) => s.nodes);

  const chatIds = paneTabs?.chatIds ?? [];
  const activeChatId = paneTabs?.activeChatId ?? null;

  if (chatIds.length === 0) return null;

  return (
    <div className="flex items-end bg-surface border-b border-border h-[35px] overflow-x-auto">
      {chatIds.map((chatId) => {
        const node = nodes.find((n) => n.id === chatId);
        const name = node?.name ?? "Untitled";
        const isActive = chatId === activeChatId;

        return (
          <div
            key={chatId}
            className={`flex items-center gap-1.5 px-3 h-[34px] cursor-pointer border-r border-border text-xs select-none shrink-0 max-w-[160px] group ${
              isActive
                ? "bg-bg text-fg border-b-0"
                : "bg-surface text-fg-muted hover:bg-surface-hover"
            }`}
            onClick={() => setActiveTab(paneId, chatId)}
          >
            <MessageSquare size={12} className="text-icon-chat shrink-0" />
            <span className="truncate">{name}</span>
            <button
              className="ml-auto shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-hover transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(paneId, chatId);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
