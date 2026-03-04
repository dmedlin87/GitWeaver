import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildContextPack } from '../../src/planning/context-pack';
import { freezePlan } from '../../src/planning/plan-freeze';
import { assertPromptDrift } from '../../src/planning/prompt-envelope';
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

    it('should respect byte budget and select files deterministically based on tier and path', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), '1234567890'); // 10 bytes, tier: must
      fs.writeFileSync(path.join(tempDir, 'a_allow.txt'), '1234567890'); // 10 bytes, tier: should
      fs.writeFileSync(path.join(tempDir, 'z_allow.txt'), '1234567890'); // 10 bytes, tier: should
      fs.writeFileSync(path.join(tempDir, 'a_consume.txt'), '1234567890'); // 10 bytes, tier: optional
      fs.writeFileSync(path.join(tempDir, 'z_consume.txt'), '1234567890'); // 10 bytes, tier: optional

      const task1 = {
        taskId: 't1',
        writeScope: { allow: ['z_allow.txt', 'a_allow.txt'] },
        artifactIO: { consumes: ['z_consume.txt', 'a_consume.txt'] }
      } as unknown as TaskContract;

      // Byte budget = 25 bytes.
      // 1. package.json (10 bytes) - selected
      // 2. a_allow.txt (10 bytes) - selected
      // Total = 20 bytes.
      // 3. z_allow.txt (10 bytes) - skipped (exceeds budget)
      // 4. a_consume.txt (10 bytes) - skipped
      // 5. z_consume.txt (10 bytes) - skipped

      const pack1 = buildContextPack(tempDir, task1, 25);

      expect(pack1.must.map(f => f.path)).toEqual(['package.json']);
      expect(pack1.should.map(f => f.path)).toEqual(['a_allow.txt']);
      expect(pack1.optional.map(f => f.path)).toEqual([]);
      expect(pack1.selectedTotalBytes).toBe(20);

      // Even if order is different, should yield identical context pack
      const task2 = {
        taskId: 't1',
        writeScope: { allow: ['a_allow.txt', 'z_allow.txt'] },
        artifactIO: { consumes: ['a_consume.txt', 'z_consume.txt'] }
      } as unknown as TaskContract;

      const pack2 = buildContextPack(tempDir, task2, 25);
      expect(pack1.contextPackHash).toBe(pack2.contextPackHash);
    });

    it('should exclude contextPackHash when calculating its own hash to prevent circularity non-determinism', async () => {
      const task = {
        taskId: 't1',
        writeScope: { allow: [] },
        artifactIO: { consumes: [] }
      } as unknown as TaskContract;

      const pack = buildContextPack(tempDir, task);
      const hash1 = pack.contextPackHash;

      // If we manually change the hash, re-stringifying should still produce the same hash
      const packCopy = { ...pack, contextPackHash: 'some-other-hash' };
      const { stableStringify, sha256 } = await import('../../src/core/hash.js');
      const hash2 = sha256(stableStringify({ ...packCopy, contextPackHash: undefined }));

      expect(hash1).toBe(hash2);
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
      const { buildPromptEnvelope } = await import('../../src/planning/prompt-envelope.js');
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
      const { buildPromptEnvelope } = await import('../../src/planning/prompt-envelope.js');
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
    it('should throw on taskId drift', () => {
      const env1 = { taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      const env2 = { taskId: 't2', runId: 'r1', provider: 'p1', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      expect(() => assertPromptDrift(env1, env2)).toThrow(/taskId drift/);
    });

    it('should throw on runId drift', () => {
      const env1 = { taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      const env2 = { taskId: 't1', runId: 'r2', provider: 'p1', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      expect(() => assertPromptDrift(env1, env2)).toThrow(/runId drift/);
    });

    it('should throw on provider drift', () => {
      const env1 = { taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      const env2 = { taskId: 't1', runId: 'r1', provider: 'p2', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      expect(() => assertPromptDrift(env1, env2)).toThrow(/provider drift/);
    });

    it('should throw on baselineCommit drift', () => {
      const env1 = { taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      const env2 = { taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c2', immutableSectionsHash: 'hashA', taskContractHash: 'hashB', contextPackHash: 'hashC' } as PromptEnvelope;
      expect(() => assertPromptDrift(env1, env2)).toThrow(/baselineCommit drift/);
    });

    it('should throw on immutable section drift', () => {
      const env1 = {
        taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1',
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC'
      } as PromptEnvelope;

      const env2 = {
        taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1',
        immutableSectionsHash: 'hashZ', // Changed
        taskContractHash: 'hashB',
        contextPackHash: 'hashC'
      } as PromptEnvelope;

      expect(() => assertPromptDrift(env1, env2)).toThrow(/drift/);
    });

    it('should allow mutable section changes', () => {
      const env1 = {
        taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1',
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC',
        mutableSections: { failureEvidence: [] }
      } as PromptEnvelope;

      const env2 = {
        taskId: 't1', runId: 'r1', provider: 'p1', baselineCommit: 'c1',
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC',
        mutableSections: { failureEvidence: ['error'] } // Changed
      } as PromptEnvelope;

      expect(() => assertPromptDrift(env1, env2)).not.toThrow();
    });

    it('should reject drift in any field other than mutable sections', () => {
      const baseEnv = {
        taskId: 't1', runId: 'r1', provider: 'p1', attempt: 1, baselineCommit: 'c1',
        immutableSectionsHash: 'hashA',
        taskContractHash: 'hashB',
        contextPackHash: 'hashC',
        mutableSections: { failureEvidence: [] }
      } as PromptEnvelope;

      // taskContractHash drift
      const env2 = { ...baseEnv, taskContractHash: 'hashB_drift' };
      expect(() => assertPromptDrift(baseEnv, env2)).toThrow(/contract hash drift detected/);

      // contextPackHash drift
      const env3 = { ...baseEnv, contextPackHash: 'hashC_drift' };
      expect(() => assertPromptDrift(baseEnv, env3)).toThrow(/context hash drift detected/);
    });
  });
});
