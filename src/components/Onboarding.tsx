import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSettingsStore } from "../stores/settingsStore";

type Step = "workspace" | "apiKey";

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("workspace");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const setRootPath = useWorkspaceStore((s) => s.setRootPath);
  const setProviderConfig = useSettingsStore((s) => s.setProviderConfig);

  async function pickWorkspace() {
    try {
      const result = await open({ directory: true, multiple: false, title: "Choose Workspace Folder" });
      if (typeof result === "string") {
        setSelectedPath(result);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function confirmWorkspace() {
    if (!selectedPath) return;
    setLoading(true);
    setError(null);
    try {
      const dbPath = `${selectedPath}/snak.db`;
      await invoke("open_workspace", { dbPath });
      await invoke("save_workspace", { path: selectedPath });
      setRootPath(selectedPath);
      setStep("apiKey");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveApiKey() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("set_api_key", { provider, apiKey: apiKey.trim() });
      setProviderConfig(provider, { hasApiKey: true });
      onComplete();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-xl">
        {step === "workspace" && (
          <>
            <h1 className="mb-2 text-2xl font-semibold">Welcome to Snak</h1>
            <p className="mb-6 text-sm text-zinc-400">
              Choose a folder on your machine where your chats will be stored.
            </p>

            <button
              onClick={pickWorkspace}
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-left text-sm hover:bg-zinc-700 active:bg-zinc-600 transition-colors"
            >
              {selectedPath ? (
                <span className="font-mono text-xs text-zinc-300 break-all">{selectedPath}</span>
              ) : (
                <span className="text-zinc-400">Click to choose workspace folder…</span>
              )}
            </button>

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <button
              onClick={confirmWorkspace}
              disabled={!selectedPath || loading}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Opening…" : "Continue"}
            </button>
          </>
        )}

        {step === "apiKey" && (
          <>
            <h1 className="mb-2 text-2xl font-semibold">Add an API Key</h1>
            <p className="mb-6 text-sm text-zinc-400">
              Enter your first provider API key. You can add more later in Settings.
            </p>

            <label className="mb-1 block text-xs text-zinc-400 uppercase tracking-wider">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="openrouter">OpenRouter</option>
            </select>

            <label className="mb-1 block text-xs text-zinc-400 uppercase tracking-wider">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
              placeholder="sk-…"
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={onComplete}
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
              >
                Skip for now
              </button>
              <button
                onClick={saveApiKey}
                disabled={!apiKey.trim() || loading}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Saving…" : "Save & Continue"}
              </button>
            </div>
          </>
        )}

        <div className="mt-6 flex justify-center gap-2">
          {(["workspace", "apiKey"] as Step[]).map((s) => (
            <div
              key={s}
              className={`h-1.5 w-6 rounded-full transition-colors ${step === s ? "bg-indigo-500" : "bg-zinc-700"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
