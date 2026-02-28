#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_BUILT_DEPS = ['esbuild', 'node-pty'];
const WORKSPACE_FILE = path.resolve(process.cwd(), 'pnpm-workspace.yaml');

function ensureOnlyBuiltDependencies() {
  const original = existsSync(WORKSPACE_FILE)
    ? readFileSync(WORKSPACE_FILE, 'utf8')
    : '';
  const lines = original.split(/\r?\n/);
  const rewritten = [];
  let foundKey = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*onlyBuiltDependencies\s*:\s*$/.test(line)) {
      foundKey = true;
      rewritten.push('onlyBuiltDependencies:');
      for (const dep of REQUIRED_BUILT_DEPS) {
        rewritten.push(`  - ${dep}`);
      }
      index += 1;
      while (index < lines.length) {
        const candidate = lines[index];
        if (/^\s*-\s+/.test(candidate) || /^\s*$/.test(candidate)) {
          index += 1;
          continue;
        }
        index -= 1;
        break;
      }
      continue;
    }
    rewritten.push(line);
  }

  if (!foundKey) {
    if (rewritten.length > 0 && rewritten[rewritten.length - 1] !== '') {
      rewritten.push('');
    }
    rewritten.push('onlyBuiltDependencies:');
    for (const dep of REQUIRED_BUILT_DEPS) {
      rewritten.push(`  - ${dep}`);
    }
  }

  const normalized = `${rewritten.join('\n').replace(/\n+$/, '')}\n`;
  if (normalized !== original) {
    writeFileSync(WORKSPACE_FILE, normalized, 'utf8');
    console.log('[fix] Updated pnpm-workspace.yaml build approvals');
  } else {
    console.log('[fix] pnpm-workspace.yaml build approvals already correct');
  }
}

function runCommand(command, args) {
  console.log(`[run] ${command} ${args.join(' ')}`);
  const result =
    process.platform === 'win32' && command === 'pnpm'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `pnpm ${args.join(' ')}`], {
          stdio: 'inherit',
        })
      : spawnSync(command, args, {
          stdio: 'inherit',
        });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function main() {
  ensureOnlyBuiltDependencies();
  runCommand('pnpm', ['install']);
  runCommand('pnpm', ['typecheck']);
  runCommand('pnpm', ['test']);
  console.log('[ok] Local install and verification succeeded');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
}
