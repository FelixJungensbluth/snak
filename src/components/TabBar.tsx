import { useMemo } from "react";
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

  // O(1) lookup instead of O(n) find per tab
  const nodeMap = useMemo(() => {
    const map = new Map<string, (typeof nodes)[number]>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const chatIds = paneTabs?.chatIds ?? [];
  const activeChatId = paneTabs?.activeChatId ?? null;

  if (chatIds.length === 0) return null;

  return (
    <div className="flex items-end bg-surface border-b border-border h-[35px]">
      <div className="flex items-end flex-1 overflow-x-auto">
      {chatIds.map((chatId) => {
        const node = nodeMap.get(chatId);
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
              className="ml-auto shrink-0 rounded p-0.5 text-transparent group-hover:text-fg-muted hover:text-fg hover:bg-surface-hover transition-colors w-4 h-4 flex items-center justify-center"
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
    </div>
  );
}
