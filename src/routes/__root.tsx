import { createRootRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

import { useWorkspaceStore } from "../stores/workspaceStore";
import * as api from "../api/workspace";
import { useUiStore } from "../stores/uiStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useSessionPersist } from "../hooks/useSessionPersist";
import { applyTheme } from "../themes";

const Onboarding = lazy(() => import("../components/Onboarding"));
const WorkspaceChrome = lazy(() => import("../components/WorkspaceChrome"));

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const setRootPath = useWorkspaceStore((s) => s.setRootPath);
  const setNodes = useWorkspaceStore((s) => s.setNodes);
  const setLoading = useWorkspaceStore((s) => s.setLoading);
  const [initialized, setInitialized] = useState(false);

  // Session persistence (save/restore pane layout, tabs, scroll positions)
  useSessionPersist();

  // Apply saved theme on mount
  useEffect(() => {
    applyTheme(useSettingsStore.getState().theme);
  }, []);

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
    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    function scheduleDeferredReindex(savedPath: string) {
      const startReindex = () => {
        if (cancelled) return;
        api.reindexAllChats(savedPath).catch((e) =>
          console.error("FTS reindex failed:", e)
        );
      };

      if (typeof window.requestIdleCallback === "function") {
        idleHandle = window.requestIdleCallback(startReindex);
      } else {
        timeoutHandle = setTimeout(startReindex, 1200);
      }
    }

    async function restoreWorkspace() {
      try {
        const savedPath = await api.getSavedWorkspace();
        if (savedPath) {
          setLoading(true);
          await api.openWorkspace(savedPath + "/snak.db");
          const nodes = await api.listNodes();
          setNodes(nodes);
          setRootPath(savedPath);
          scheduleDeferredReindex(savedPath);
        }
      } catch (e) {
        console.error("Failed to restore workspace:", e);
      } finally {
        setLoading(false);
        setInitialized(true);
      }
    }
    restoreWorkspace();
    return () => {
      cancelled = true;
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    };
  }, []);

  if (!initialized) {
    return (
      <div className="flex items-center justify-center h-screen text-fg-dim text-xs">
        Loading…
      </div>
    );
  }

  if (!rootPath) {
    return (
      <Suspense fallback={null}>
        <Onboarding />
      </Suspense>
    );
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen text-fg-dim text-xs">
          Loading workspace…
        </div>
      }
    >
      <WorkspaceChrome />
    </Suspense>
  );
}
