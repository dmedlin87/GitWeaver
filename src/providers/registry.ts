import type { ProviderId, ProviderSpec } from "../core/types.js";

export const PROVIDER_SPECS: Record<ProviderId, ProviderSpec> = {
  codex: {
    id: "codex",
    npmPackage: "@openai/codex",
    binary: "codex",
    versionArgs: ["--version"],
    authCheckCommand: ["login", "status"],
    authFixCommand: "codex login",
    installFallbackByOs: {
      darwin: "brew install --cask codex"
    },
    windowsNotes: "OpenAI recommends WSL for best Codex CLI reliability on Windows."
  },
  claude: {
    id: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    binary: "claude",
    versionArgs: ["--version"],
    authCheckCommand: ["auth", "status"],
    authFixCommand: "claude auth login",
    installFallbackByOs: {
      win32: "winget install --id Anthropic.Claude -e"
    }
  },
  gemini: {
    id: "gemini",
    npmPackage: "@google/gemini-cli",
    binary: "gemini",
    versionArgs: ["--version"],
    authFixCommand: "gemini",
    installFallbackByOs: {
      darwin: "brew install gemini-cli"
    }
  }
};

export function providerList(): ProviderId[] {
  return ["codex", "claude", "gemini"];
}