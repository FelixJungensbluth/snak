import { useEffect, useRef } from "react";
import { usePaneStore, type PaneNode } from "../stores/paneStore";
import { useTabStore } from "../stores/tabStore";
import { useSessionStore } from "../stores/sessionStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import * as api from "../api/workspace";

interface SessionData {
  paneLayout: PaneNode;
  activeTabs: Record<string, string | null>;
  openTabs: Record<string, string[]>;
  scrollPositions: Record<string, number>;
}

/** Collect all leaf pane IDs from the pane tree */
function collectLeafIds(node: PaneNode): string[] {
  if (node.kind === "leaf") return [node.id];
  return [...collectLeafIds(node.first), ...collectLeafIds(node.second)];
}

/**
 * Hydrates session state on mount, then auto-saves on changes.
 * Must be called inside a component that has access to a workspace rootPath.
 */
export function useSessionPersist() {
  const rootPath = useWorkspaceStore((s) => s.rootPath);
  const nodes = useWorkspaceStore((s) => s.nodes);
  const hydrated = useSessionStore((s) => s.hydrated);
  const setHydrated = useSessionStore((s) => s.setHydrated);
  const hydratingRef = useRef(false);

  // ── Hydrate on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!rootPath || hydrated || hydratingRef.current) return;
    hydratingRef.current = true;

    (async () => {
      try {
        const json = await api.loadSession();
        if (!json) {
          setHydrated(true);
          return;
        }

        const data: SessionData = JSON.parse(json);
        // Collect valid chatIds from workspace nodes
        const validIds = new Set(nodes.map((n) => n.id));

        // Restore pane layout
        if (data.paneLayout) {
          usePaneStore.getState().setRoot(data.paneLayout);

          // Focus the first leaf
          let cursor: PaneNode = data.paneLayout;
          while (cursor.kind === "split") cursor = cursor.first;
          usePaneStore.getState().setFocusedPane(cursor.id);
        }

        // Restore tabs, silently skipping deleted chats
        const leafIds = data.paneLayout
          ? collectLeafIds(data.paneLayout)
          : [];

        for (const paneId of leafIds) {
          const chatIds = (data.openTabs[paneId] ?? []).filter((id) =>
            validIds.has(id)
          );
          const activeId = data.activeTabs[paneId];
          const validActive =
            activeId && validIds.has(activeId) ? activeId : null;

          for (const chatId of chatIds) {
            useTabStore.getState().openTab(paneId, chatId);
          }
          if (validActive) {
            useTabStore.getState().setActiveTab(paneId, validActive);
          }
        }

        // Restore scroll positions
        if (data.scrollPositions) {
          for (const [chatId, pos] of Object.entries(data.scrollPositions)) {
            if (validIds.has(chatId)) {
              useSessionStore.getState().setScrollPosition(chatId, pos);
            }
          }
        }
      } catch (e) {
        console.error("Failed to restore session:", e);
      } finally {
        setHydrated(true);
      }
    })();
  }, [rootPath, nodes, hydrated, setHydrated]);

  // ── Auto-save on changes ──────────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to store changes and debounce saves
  useEffect(() => {
    if (!rootPath || !hydrated) return;

    const save = () => {
      const paneLayout = usePaneStore.getState().root;
      const tabPanes = useTabStore.getState().panes;
      const scrollPositions = useSessionStore.getState().scrollPositions;

      const activeTabs: Record<string, string | null> = {};
      const openTabs: Record<string, string[]> = {};

      for (const [paneId, paneTabs] of Object.entries(tabPanes)) {
        activeTabs[paneId] = paneTabs.activeChatId;
        openTabs[paneId] = [...paneTabs.chatIds];
      }

      const data: SessionData = {
        paneLayout,
        activeTabs,
        openTabs,
        scrollPositions,
      };

      api.saveSession(JSON.stringify(data))
        .catch((e) => console.error("Failed to save session:", e));
    };

    const debouncedSave = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(save, 500);
    };

    // Subscribe to all relevant stores
    const unsubs = [
      usePaneStore.subscribe(debouncedSave),
      useTabStore.subscribe(debouncedSave),
      useSessionStore.subscribe(debouncedSave),
    ];

    return () => {
      unsubs.forEach((fn) => fn());
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [rootPath, hydrated]);
}
