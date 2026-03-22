import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useWorkspaceStore } from "../stores/workspaceStore";
import * as api from "../api/workspace";
import { useUiStore } from "../stores/uiStore";
import { useSessionPersist } from "../hooks/useSessionPersist";
import Onboarding from "../components/Onboarding";
import Sidebar from "../components/Sidebar";
import SettingsPanel from "../components/SettingsPanel";
import ChatFinderOverlay from "../components/SearchOverlay";
import ContentSearchOverlay from "../components/ContentSearch";
import { TabDndProvider } from "../components/TabDndContext";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const setRootPath = useWorkspaceStore((s) => s.setRootPath);
  const setNodes = useWorkspaceStore((s) => s.setNodes);
  const setLoading = useWorkspaceStore((s) => s.setLoading);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const [initialized, setInitialized] = useState(false);

  // Session persistence (save/restore pane layout, tabs, scroll positions)
  useSessionPersist();

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const ui = useUiStore.getState();

      // Cmd+P or Cmd+K — Chat finder (find files)
      if (mod && (e.key === "p" || e.key === "k") && !e.shiftKey) {
        e.preventDefault();
        if (ui.chatFinderOpen) {
          ui.closeChatFinder();
        } else {
          ui.openChatFinder();
        }
        return;
      }

      // Cmd+Shift+F — Content search (grep messages)
      if (mod && e.shiftKey && e.key === "f") {
        e.preventDefault();
        if (ui.contentSearchOpen) {
          ui.closeContentSearch();
        } else {
          ui.openContentSearch();
        }
        return;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    async function restoreWorkspace() {
      try {
        const savedPath = await api.getSavedWorkspace();
        if (savedPath) {
          setLoading(true);
          await api.openWorkspace(savedPath + "/snak.db");
          const nodes = await api.listNodes();
          setNodes(nodes);
          setRootPath(savedPath);
          // Rebuild FTS index from all chat files (fire-and-forget)
          api.reindexAllChats(savedPath).catch((e) =>
            console.error("FTS reindex failed:", e)
          );
        }
      } catch (e) {
        console.error("Failed to restore workspace:", e);
      } finally {
        setLoading(false);
        setInitialized(true);
      }
    }
    restoreWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen text-fg-dim text-xs">
        Loading…
      </div>
    );
  }

  if (!rootPath) {
    return <Onboarding />;
  }

  return (
    <TabDndProvider>
      <div className="flex h-screen overflow-hidden relative border-t border-border">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-bg">
          {settingsOpen ? <SettingsPanel /> : <Outlet />}
        </main>
        <ChatFinderOverlay />
        <ContentSearchOverlay />
      </div>
    </TabDndProvider>
  );
}
