import { useEffect, useMemo, useRef, useState } from "react";
import { X, MessageSquare, PanelRight, PanelBottom, XCircle } from "lucide-react";
import { useTabStore } from "../stores/tabStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePaneStore } from "../stores/paneStore";

interface TabBarProps {
  paneId: string;
  isFocused?: boolean;
}

export default function TabBar({ paneId, isFocused }: TabBarProps) {
  const paneTabs = useTabStore((s) => s.panes[paneId]);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);
  const closeOtherTabs = useTabStore((s) => s.closeOtherTabs);
  const closeTabsToRight = useTabStore((s) => s.closeTabsToRight);
  const openTab = useTabStore((s) => s.openTab);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const splitPane = usePaneStore((s) => s.splitPane);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; chatId: string } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e: MouseEvent) => {
      if (!ctxMenuRef.current?.contains(e.target as Node)) setCtxMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ctxMenu]);

  // O(1) lookup instead of O(n) find per tab
  const nodeMap = useMemo(() => {
    const map = new Map<string, (typeof nodes)[number]>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const chatIds = paneTabs?.chatIds ?? [];
  const activeChatId = paneTabs?.activeChatId ?? null;

  function handleSplit(direction: "horizontal" | "vertical") {
    if (!ctxMenu) return;
    const newPaneId = Math.random().toString(36).slice(2, 10);
    splitPane(paneId, direction, newPaneId);
    // Open the same chat in the new pane
    openTab(newPaneId, ctxMenu.chatId);
    setCtxMenu(null);
  }

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
                ? `bg-bg text-fg border-t-2 ${isFocused ? "border-t-accent" : "border-t-transparent"}`
                : "bg-surface text-fg-muted hover:bg-surface-hover border-t-2 border-t-transparent"
            }`}
            onClick={() => setActiveTab(paneId, chatId)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCtxMenu({ x: e.clientX, y: e.clientY, chatId });
            }}
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

      {/* Tab context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50 bg-surface-raised border border-border-strong rounded shadow-xl py-0.5 min-w-[160px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <TabCtxItem
            icon={<PanelRight size={12} />}
            label="Split Right"
            onClick={() => handleSplit("horizontal")}
          />
          <TabCtxItem
            icon={<PanelBottom size={12} />}
            label="Split Down"
            onClick={() => handleSplit("vertical")}
          />
          <div className="my-0.5 border-t border-border-strong" />
          <TabCtxItem
            icon={<XCircle size={12} />}
            label="Close Other Tabs"
            onClick={() => {
              closeOtherTabs(paneId, ctxMenu.chatId);
              setCtxMenu(null);
            }}
          />
          <TabCtxItem
            icon={<X size={12} />}
            label="Close Tabs to Right"
            onClick={() => {
              closeTabsToRight(paneId, ctxMenu.chatId);
              setCtxMenu(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

function TabCtxItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left px-3 py-1 text-xs flex items-center gap-2 text-fg hover:bg-accent-selection transition-colors"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );
}
