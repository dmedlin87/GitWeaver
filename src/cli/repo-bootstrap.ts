import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runCommand } from "../core/shell.js";

export type BootstrapTemplate = "blank" | "web-game-ts";

export interface RepoBootstrapOptions {
  repo?: string;
  bootstrap?: boolean;
  bootstrapTemplate?: BootstrapTemplate;
}

export interface RepoBootstrapResult {
  repoPath: string;
  createdFiles: string[];
  initializedGit: boolean;
  createdInitialCommit: boolean;
}

export async function maybeBootstrapRepo(options: RepoBootstrapOptions): Promise<RepoBootstrapResult | undefined> {
  if (!options.bootstrap) {
    return undefined;
  }
  if (!options.repo) {
    throw new Error("--bootstrap requires --repo <path>");
  }

  const repoPath = resolve(options.repo);
  mkdirSync(repoPath, { recursive: true });

  const initializedGit = !(await isGitRepo(repoPath));
  if (initializedGit) {
    const init = await runCommand("git", ["-C", repoPath, "init"], { timeoutMs: 15_000 });
    if (init.code !== 0) {
      throw new Error(`Failed to initialize git repository: ${init.stderr || init.stdout}`.trim());
    }
  }

  const template = options.bootstrapTemplate ?? "blank";
  const createdFiles = template === "web-game-ts" ? scaffoldWebGameTemplate(repoPath) : scaffoldBlankTemplate(repoPath);

  const hasHeadCommit = await hasHead(repoPath);
  const createdInitialCommit = await commitIfNeeded(repoPath, hasHeadCommit);

  return {
    repoPath,
    createdFiles,
    initializedGit,
    createdInitialCommit
  };
}

async function isGitRepo(repoPath: string): Promise<boolean> {
  const status = await runCommand("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], { timeoutMs: 10_000 });
  return status.code === 0;
}

async function hasHead(repoPath: string): Promise<boolean> {
  const head = await runCommand("git", ["-C", repoPath, "rev-parse", "--verify", "HEAD"], { timeoutMs: 10_000 });
  return head.code === 0;
}

async function commitIfNeeded(repoPath: string, hasHeadCommit: boolean): Promise<boolean> {
  if (hasHeadCommit) {
    return false;
  }

  const status = await runCommand("git", ["-C", repoPath, "status", "--porcelain"], { timeoutMs: 10_000 });
  if (status.code !== 0 || status.stdout.trim().length === 0) {
    return false;
  }

  const add = await runCommand("git", ["-C", repoPath, "add", "-A"], { timeoutMs: 10_000 });
  if (add.code !== 0) {
    throw new Error(`Failed to stage bootstrap files: ${add.stderr || add.stdout}`.trim());
  }

  const commit = await runCommand(
    "git",
    ["-C", repoPath, "commit", "-m", "chore:bootstrap-repository-for-orchestrator"],
    { timeoutMs: 15_000 }
  );
  if (commit.code !== 0) {
    const reason = (commit.stderr || commit.stdout || "unknown error").trim();
    throw new Error(`Failed to create initial bootstrap commit. Configure git user.name and user.email. ${reason}`);
  }

  return true;
}

function scaffoldBlankTemplate(repoPath: string): string[] {
  const created: string[] = [];
  created.push(...writeIfMissing(join(repoPath, "README.md"), `# ${projectNameFromPath(repoPath)}\n`));
  created.push(...writeIfMissing(join(repoPath, ".gitignore"), "node_modules/\ndist/\n.orchestrator/\n"));
  return created;
}

function scaffoldWebGameTemplate(repoPath: string): string[] {
  const created: string[] = [];

  created.push(
    ...writeIfMissing(
      join(repoPath, "package.json"),
      JSON.stringify(
        {
          name: projectNameFromPath(repoPath),
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            build: "tsc -p tsconfig.json",
            typecheck: "tsc --noEmit",
            test: "vitest run"
          },
          devDependencies: {
            "@types/node": "^24.0.0",
            typescript: "^5.9.0",
            vitest: "^4.0.0"
          }
        },
        null,
        2
      ) + "\n"
    )
  );

  created.push(
    ...writeIfMissing(
      join(repoPath, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2023",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            types: ["node", "vitest/globals"]
          },
          include: ["src/**/*.ts", "tests/**/*.ts"]
        },
        null,
        2
      ) + "\n"
    )
  );

  created.push(...writeIfMissing(join(repoPath, "index.html"), webGameIndexHtml()));
  created.push(...writeIfMissing(join(repoPath, "src/main.ts"), webGameMainTs()));
  created.push(...writeIfMissing(join(repoPath, "tests/smoke.test.ts"), webGameSmokeTest()));
  created.push(...writeIfMissing(join(repoPath, "README.md"), `# ${projectNameFromPath(repoPath)}\n`));
  created.push(...writeIfMissing(join(repoPath, ".gitignore"), "node_modules/\ndist/\n.orchestrator/\n"));

  return created;
}

function writeIfMissing(path: string, content: string): string[] {
  if (existsSync(path)) {
    return [];
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return [path];
}

function projectNameFromPath(repoPath: string): string {
  const raw = repoPath.split(/[\\/]/u).pop() ?? "project";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "") || "project";
}

function webGameIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Snake Game</title>
  </head>
  <body>
    <h1>Snake Game</h1>
    <p>Starter scaffold generated by GitWeaver bootstrap.</p>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
`;
}

function webGameMainTs(): string {
  return `export function bootstrapGame(): string {
  return "Snake game scaffold ready";
}

if (typeof document !== "undefined") {
  const node = document.createElement("pre");
  node.textContent = bootstrapGame();
  document.body.appendChild(node);
}
`;
}

function webGameSmokeTest(): string {
  return `import { describe, expect, it } from "vitest";
import { bootstrapGame } from "../src/main.js";

describe("bootstrapGame", () => {
  it("returns starter status", () => {
    expect(bootstrapGame()).toContain("ready");
  });
});
`;
}
