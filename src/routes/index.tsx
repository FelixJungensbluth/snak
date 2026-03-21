import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: WorkspaceHome,
});

function WorkspaceHome() {
  return (
    <div className="flex flex-1 items-center justify-center text-zinc-600 text-sm select-none">
      <p>Select a chat from the sidebar or create a new one.</p>
    </div>
  );
}
