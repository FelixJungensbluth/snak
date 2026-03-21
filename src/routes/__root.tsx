import { createRootRoute, Outlet } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Onboarding } from "../components/Onboarding";
import { Sidebar } from "../components/Sidebar";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { WorkspaceNode } from "../stores/workspaceStore";

function AppShell() {
  const { rootPath, setRootPath, setNodes } = useWorkspaceStore();
  const [checking, setChecking] = useState(true);
  // Once onboarding completes we re-check; bump this to trigger the effect
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    (async () => {
      setChecking(true);
      try {
        const saved = await invoke<string | null>("get_saved_workspace");
        if (saved) {
          await invoke("open_workspace", { dbPath: `${saved}/snak.db` });
          setRootPath(saved);
          const nodes = await invoke<WorkspaceNode[]>("list_nodes");
          setNodes(nodes);
        }
      } catch {
        // First launch or corrupted store — show onboarding
      } finally {
        setChecking(false);
      }
    })();
  }, [recheck]); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-500 text-sm">
        Loading…
      </div>
    );
  }

  if (!rootPath) {
    return <Onboarding onComplete={() => setRecheck((n) => n + 1)} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createRootRoute({
  component: AppShell,
});
