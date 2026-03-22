export const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-...", needsKey: true },
  { id: "openai", label: "OpenAI", placeholder: "sk-...", needsKey: true },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-...", needsKey: true },
  { id: "ollama", label: "Ollama", placeholder: "", needsKey: false },
] as const;

export const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4-turbo",
    "o3",
    "o4-mini",
  ],
  openrouter: [
    "anthropic/claude-sonnet-4",
    "openai/gpt-4o",
    "google/gemini-2.5-pro",
    "meta-llama/llama-4-maverick",
  ],
  ollama: [
    "llama3.3",
    "llama3.2",
    "mistral",
    "codellama",
    "gemma2",
    "phi3",
    "qwen2.5",
  ],
};

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
};
