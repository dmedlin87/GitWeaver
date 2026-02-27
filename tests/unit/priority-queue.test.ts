import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { PriorityQueue } from '../../src/scheduler/priority-queue.js';

describe('PriorityQueue', () => {
  let queue: PriorityQueue<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    queue = new PriorityQueue<string>();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic operations', () => {
    it('enqueues and dequeues items', () => {
      queue.enqueue('task1', 'payload1');
      expect(queue.size()).toBe(1);
      expect(queue.has('task1')).toBe(true);

      const item = queue.dequeue();
      expect(item).toBe('payload1');
      expect(queue.size()).toBe(0);
      expect(queue.has('task1')).toBe(false);
    });

    it('returns undefined when dequeuing empty queue', () => {
      expect(queue.dequeue()).toBeUndefined();
    });

    it('handles multiple items', () => {
      queue.enqueue('task1', 'payload1');
      queue.enqueue('task2', 'payload2');
      expect(queue.size()).toBe(2);

      // Same priority and time -> FIFO
      expect(queue.dequeue()).toBe('payload1');
      expect(queue.dequeue()).toBe('payload2');
    });

    it('updates existing items', () => {
      queue.enqueue('task1', 'payload1');
      queue.enqueue('task1', 'payload1-updated');
      expect(queue.size()).toBe(1);
      expect(queue.dequeue()).toBe('payload1-updated');
    });
  });

  describe('priority handling', () => {
    it('dequeues higher priority items first', () => {
      queue.enqueue('low', 'low-priority', 0);
      queue.enqueue('high', 'high-priority', 10);

      expect(queue.dequeue()).toBe('high-priority');
      expect(queue.dequeue()).toBe('low-priority');
    });

    it('respects priority order with multiple items', () => {
      queue.enqueue('p1', 'p1', 1);
      queue.enqueue('p3', 'p3', 3);
      queue.enqueue('p2', 'p2', 2);

      expect(queue.dequeue()).toBe('p3');
      expect(queue.dequeue()).toBe('p2');
      expect(queue.dequeue()).toBe('p1');
    });
  });

  describe('aging mechanism', () => {
    it('allows older low-priority items to overtake newer high-priority items', () => {
      // Score = priority + age/30

      // Add low priority item (p=0)
      queue.enqueue('old-low', 'old-low', 0);

      // Advance time by 60 seconds (adds 2 to score: 60/30 = 2)
      // Score for old-low = 0 + 2 = 2
      vi.advanceTimersByTime(60000);

      // Add medium priority item (p=1)
      // New item age=0, score = 1 + 0 = 1
      queue.enqueue('new-med', 'new-med', 1);

      expect(queue.dequeue()).toBe('old-low');
      expect(queue.dequeue()).toBe('new-med');
    });

    it('does not overtake if not old enough', () => {
      queue.enqueue('old-low', 'old-low', 0);

      // Advance time by 15 seconds (adds 0.5 to score)
      // Score for old-low = 0 + 0.5 = 0.5
      vi.advanceTimersByTime(15000);

      // Add medium priority item (p=1)
      // New item age=0, score = 1
      queue.enqueue('new-med', 'new-med', 1);

      expect(queue.dequeue()).toBe('new-med');
      expect(queue.dequeue()).toBe('old-low');
    });
  });
});
