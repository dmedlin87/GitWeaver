import { join } from "node:path";
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
    windowsNotes: "OpenAI recommends WSL for best Codex CLI reliability on Windows.",
    configPaths: [".codex"]
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
    },
    configPaths: [".claude"]
  },
  gemini: {
    id: "gemini",
    npmPackage: "@google/gemini-cli",
    binary: "gemini",
    versionArgs: ["--version"],
    authFixCommand: "gemini",
    installFallbackByOs: {
      darwin: "brew install gemini-cli"
    },
    configPaths: [".gemini", join(".config", "gemini")]
  }
};

export function providerList(): ProviderId[] {
  return ["codex", "claude", "gemini"];
}