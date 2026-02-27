import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { GeminiAdapter } from "./gemini.js";
import type { ProviderAdapter } from "./types.js";
import type { ProviderId } from "../../core/types.js";

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
  gemini: new GeminiAdapter()
};

export function getProviderAdapter(provider: ProviderId): ProviderAdapter {
  return ADAPTERS[provider];
}
