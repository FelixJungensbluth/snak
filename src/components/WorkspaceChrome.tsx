import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useUiStore } from "../stores/uiStore";
import { TabDndProvider } from "./TabDndContext";
import Sidebar from "./Sidebar";

const SettingsPanel = lazy(() => import("./SettingsPanel"));
const ChatFinderOverlay = lazy(() => import("./SearchOverlay"));
const ContentSearchOverlay = lazy(() => import("./ContentSearch"));
const CommandPalette = lazy(() => import("./CommandPalette"));

export default function WorkspaceChrome() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);

  return (
    <TabDndProvider>
      <div className="flex h-screen overflow-hidden relative border-t border-border">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-bg">
          <Suspense fallback={null}>
            {settingsOpen ? <SettingsPanel /> : <Outlet />}
          </Suspense>
        </main>
        <Suspense fallback={null}>
          <ChatFinderOverlay />
          <ContentSearchOverlay />
          <CommandPalette />
        </Suspense>
      </div>
    </TabDndProvider>
  );
}
