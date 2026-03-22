import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings } from "lucide-react";
import { useWorkspaceStore, type WorkspaceNode } from "../stores/workspaceStore";
import { useUiStore } from "../stores/uiStore";
import Onboarding from "../components/Onboarding";
import Sidebar from "../components/Sidebar";
import SettingsPanel from "../components/SettingsPanel";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { rootPath, setRootPath, setNodes, setLoading } = useWorkspaceStore();
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    async function restoreWorkspace() {
      try {
        const savedPath = await invoke<string | null>("get_saved_workspace");
        if (savedPath) {
          setLoading(true);
          await invoke("open_workspace", { dbPath: savedPath + "/snak.db" });
          const nodes = await invoke<WorkspaceNode[]>("list_nodes");
          setNodes(nodes);
          setRootPath(savedPath);
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
    <div className="flex h-screen overflow-hidden relative">
      <Sidebar />
      <main className="flex-1 overflow-hidden bg-bg">
        <Outlet />
      </main>
      {!settingsOpen && (
        <button
          onClick={() => setSettingsOpen(true)}
          className="absolute top-3 right-3 z-30 p-1 text-fg-muted hover:text-fg transition-colors"
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={14} />
        </button>
      )}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
