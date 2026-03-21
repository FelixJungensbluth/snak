import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: WorkspaceHome,
});

function WorkspaceHome() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-xs text-fg-dim">Select or create a chat</p>
    </div>
  );
}
