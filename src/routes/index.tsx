import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const WorkspaceHomeScreen = lazy(() => import("../components/WorkspaceHome"));

export const Route = createFileRoute("/")({
  component: WorkspaceHomeRoute,
});

function WorkspaceHomeRoute() {
  return (
    <div className="h-full w-full">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-fg-dim text-xs">
            Loading workspace…
          </div>
        }
      >
        <WorkspaceHomeScreen />
      </Suspense>
    </div>
  );
}
