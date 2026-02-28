import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildContextPack } from '../../src/planning/context-pack';
import { freezePlan } from '../../src/planning/plan-freeze';
import { assertPromptDrift, buildPromptEnvelope } from '../../src/planning/prompt-envelope';
import { TaskContract, DagSpec, PromptEnvelope } from '../../src/core/types';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, 'temp_prompt_integrity_test');

describe('Prompt Integrity & Determinism', () => {
  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('ContextPack Determinism', () => {
    it('should produce identical hash and order for same files regardless of input order', () => {
      // Setup files
      fs.writeFileSync(path.join(tempDir, 'fileA.txt'), 'contentA');
      fs.writeFileSync(path.join(tempDir, 'fileB.txt'), 'contentB');

      // Task 1: order B, A
      const task1 = {
        taskId: 'task1',
        provider: 'mock',
        contractHash: 'hash1',
        writeScope: { allow: ['fileB.txt', 'fileA.txt'] },
        artifactIO: { consumes: [] }
      } as unknown as TaskContract;

      // Task 2: order A, B
      const task2 = {
        taskId: 'task1',
        provider: 'mock',
        contractHash: 'hash1',
        writeScope: { allow: ['fileA.txt', 'fileB.txt'] },
        artifactIO: { consumes: [] }
      } as unknown as TaskContract;

      const pack1 = buildContextPack(tempDir, task1);
      const pack2 = buildContextPack(tempDir, task2);

      // Verify order matches (should be sorted by path)
      const paths1 = pack1.should.map(f => f.path);
      const paths2 = pack2.should.map(f => f.path);

      // We expect them to be sorted: fileA.txt, fileB.txt
      expect(paths1).toEqual(['fileA.txt', 'fileB.txt']);
      expect(paths2).toEqual(['fileA.txt', 'fileB.txt']);

      // Verify hashes match
      expect(pack1.contextPackHash).toBe(pack2.contextPackHash);
    });
  });

  describe('Plan Freeze Determinism', () => {
    it('should produce identical dagHash for same DAG regardless of node/edge order', () => {
      const node1 = {
        taskId: 'task1',
        contractHash: 'h1',
        dependencies: [],
        writeScope: { allow: [], deny: [] },
        commandPolicy: { allow: [], deny: [] },
        artifactIO: { consumes: [], produces: [] }
      } as unknown as TaskContract;
      const node2 = {
        taskId: 'task2',
        contractHash: 'h2',
        dependencies: [],
        writeScope: { allow: [], deny: [] },
        commandPolicy: { allow: [], deny: [] },
        artifactIO: { consumes: [], produces: [] }
      } as unknown as TaskContract;

      const dag1: DagSpec = {
        nodes: [node1, node2],
        edges: [{ from: 'task1', to: 'task2' }]
      };

      const dag2: DagSpec = {
        nodes: [node2, node1], // Swapped node order
        edges: [{ from: 'task1', to: 'task2' }]
      };

      const frozen1 = freezePlan(dag1);
      const frozen2 = freezePlan(dag2);

      expect(frozen1.dag.dagHash).toBe(frozen2.dag.dagHash);
    });
  });

  describe('Prompt Envelope Hashing', () => {
    it('should produce identical immutableSectionsHash for differently ordered keys', async () => {
      const task = {
        taskId: 't1',
        provider: 'mock',
        contractHash: 'chash',
      } as unknown as TaskContract;

      const env1 = buildPromptEnvelope({
        runId: 'r1',
        task,
        attempt: 1,
        baselineCommit: 'c1',
        contextPackHash: 'cph1',
        immutableSections: { a: 1, b: 2, c: { d: 3, e: 4 } }
      });

      const env2 = buildPromptEnvelope({
        runId: 'r1',
        task,
        attempt: 1,
        baselineCommit: 'c1',
        contextPackHash: 'cph1',
        immutableSections: { c: { e: 4, d: 3 }, b: 2, a: 1 } // Reordered keys
      });

      expect(env1.immutableSectionsHash).toBe(env2.immutableSectionsHash);
    });

    it('should not change immutable hash when mutable fields change', async () => {
      const task = {
        taskId: 't1',
        provider: 'mock',
        contractHash: 'chash',
      } as unknown as TaskContract;

      const env1 = buildPromptEnvelope({
        runId: 'r1',
        task,
        attempt: 1,
        baselineCommit: 'c1',
        contextPackHash: 'cph1',
        immutableSections: { a: 1 }
      });

      const env2 = buildPromptEnvelope({
        runId: 'r1',
        task,
        attempt: 1,
        baselineCommit: 'c1',
        contextPackHash: 'cph1',
        immutableSections: { a: 1 },
        failureEvidence: ['error1'],
        boundedHints: ['hint1']
      });

      expect(env1.immutableSectionsHash).toBe(env2.immutableSectionsHash);
      expect(env1.contextPackHash).toBe(env2.contextPackHash);
      expect(env1.taskContractHash).toBe(env2.taskContractHash);
      // Mutable sections differ
      expect(env1.mutableSections).not.toEqual(env2.mutableSections);
    });
  });

  describe('Prompt Drift Assertion', () => {
    it('should throw on immutable section drift', () => {
      const env1 = {
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC'
      } as PromptEnvelope;

      const env2 = {
        immutableSectionsHash: 'hashZ', // Changed
        taskContractHash: 'hashB',
        contextPackHash: 'hashC'
      } as PromptEnvelope;

      expect(() => assertPromptDrift(env1, env2)).toThrow(/drift/);
    });

    it('should allow mutable section changes', () => {
      const env1 = {
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC',
        mutableSections: { failureEvidence: [] }
      } as PromptEnvelope;

      const env2 = {
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC',
        mutableSections: { failureEvidence: ['error'] } // Changed
      } as PromptEnvelope;

      expect(() => assertPromptDrift(env1, env2)).not.toThrow();
    });
  });
});
