import { describe, it, expect } from 'vitest';
import { freezePlan } from '../../src/planning/plan-freeze';
import { TaskContract, DagSpec } from '../../src/core/types';

describe('Plan Freeze Determinism', () => {
  const baseTask: TaskContract = {
    taskId: 'task1',
    title: 'Test Task',
    provider: 'codex',
    type: 'code',
    dependencies: [],
    writeScope: {
      allow: [],
      deny: [],
      ownership: 'exclusive'
    },
    commandPolicy: {
      allow: [],
      deny: [],
      network: 'deny'
    },
    expected: {},
    verify: {
      outputVerificationRequired: false
    },
    artifactIO: {
      consumes: [],
      produces: []
    },
    contractHash: ''
  };

  it('should produce identical contractHash for reordered set-like arrays', () => {
    const task1: TaskContract = {
      ...baseTask,
      dependencies: ['dep1', 'dep2'],
      writeScope: {
        ...baseTask.writeScope,
        allow: ['src/a.ts', 'src/b.ts'],
        deny: ['docs/a.md', 'docs/b.md']
      },
      commandPolicy: {
        ...baseTask.commandPolicy,
        allow: ['cmd1', 'cmd2'],
        deny: ['bad1', 'bad2']
      },
      artifactIO: {
        consumes: ['art1', 'art2'],
        produces: ['out1', 'out2']
      }
    };

    const task2: TaskContract = {
      ...baseTask,
      dependencies: ['dep2', 'dep1'], // Swapped
      writeScope: {
        ...baseTask.writeScope,
        allow: ['src/b.ts', 'src/a.ts'], // Swapped
        deny: ['docs/b.md', 'docs/a.md'] // Swapped
      },
      commandPolicy: {
        ...baseTask.commandPolicy,
        allow: ['cmd2', 'cmd1'], // Swapped
        deny: ['bad2', 'bad1'] // Swapped
      },
      artifactIO: {
        consumes: ['art2', 'art1'], // Swapped
        produces: ['out2', 'out1'] // Swapped
      }
    };

    const dag1: DagSpec = { nodes: [task1], edges: [] };
    const dag2: DagSpec = { nodes: [task2], edges: [] };

    const frozen1 = freezePlan(dag1);
    const frozen2 = freezePlan(dag2);

    expect(frozen1.dag.nodes[0].contractHash).toBe(frozen2.dag.nodes[0].contractHash);
  });

  it('should return tasks with sorted arrays', () => {
    const task: TaskContract = {
      ...baseTask,
      dependencies: ['z', 'a'],
      writeScope: {
        ...baseTask.writeScope,
        allow: ['z', 'a']
      }
    };

    const dag: DagSpec = { nodes: [task], edges: [] };
    const frozen = freezePlan(dag);
    const frozenTask = frozen.dag.nodes[0];

    expect(frozenTask.dependencies).toEqual(['a', 'z']);
    expect(frozenTask.writeScope.allow).toEqual(['a', 'z']);
  });
});
