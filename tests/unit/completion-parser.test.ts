import { describe, it, expect } from 'vitest';
import { parseCompletionMarker, CompletionMarker } from '../../src/execution/completion-parser.js';

describe('completion-parser', () => {
  it('parses a valid success marker', () => {
    const output = '__ORCH_DONE__: {"status": "success", "files_changed": ["a.ts"], "summary": "done"}';
    const result = parseCompletionMarker(output);
    expect(result).toEqual({
      status: 'success',
      files_changed: ['a.ts'],
      summary: 'done',
    });
  });

  it('parses a valid fail marker', () => {
    const output = '__ORCH_DONE__: {"status": "fail", "files_changed": [], "summary": "failed"}';
    const result = parseCompletionMarker(output);
    expect(result).toEqual({
      status: 'fail',
      files_changed: [],
      summary: 'failed',
    });
  });

  it('parses a marker embedded in multiline output', () => {
    const output = `
      Some logs here
      More logs
      __ORCH_DONE__: {"status": "success", "files_changed": ["b.ts"], "summary": "ok"}
      Trailing logs
    `;
    const result = parseCompletionMarker(output);
    expect(result).toEqual({
      status: 'success',
      files_changed: ['b.ts'],
      summary: 'ok',
    });
  });

  it('returns null if no marker is present', () => {
    const output = 'Just some logs\nNo marker here';
    const result = parseCompletionMarker(output);
    expect(result).toBeNull();
  });

  it('returns null if marker payload is invalid JSON and no valid marker exists', () => {
    const output = '__ORCH_DONE__: {invalid json}';
    const result = parseCompletionMarker(output);
    expect(result).toBeNull();
  });

  it('ignores markers with invalid status and finds subsequent valid marker', () => {
    // "pending" is not a valid status, so it should be skipped
    const output = `
      __ORCH_DONE__: {"status": "pending", "files_changed": [], "summary": "wait"}
      __ORCH_DONE__: {"status": "success", "files_changed": ["c.ts"], "summary": "done"}
    `;
    const result = parseCompletionMarker(output);
    expect(result).toEqual({
      status: 'success',
      files_changed: ['c.ts'],
      summary: 'done',
    });
  });

  it('returns null if valid marker has invalid status and no other marker exists', () => {
    const output = '__ORCH_DONE__: {"status": "unknown", "files_changed": [], "summary": "what"}';
    const result = parseCompletionMarker(output);
    expect(result).toBeNull();
  });

  it('parses valid marker after malformed marker', () => {
    const output = `
      __ORCH_DONE__: {invalid}
      __ORCH_DONE__: {"status": "success", "files_changed": ["d.ts"], "summary": "parsed"}
    `;
    const result = parseCompletionMarker(output);
    expect(result).toEqual({
      status: 'success',
      files_changed: ['d.ts'],
      summary: 'parsed',
    });
  });

  it('parses only valid marker when multiple markers include malformed and invalid-status entries', () => {
    const output = `
      __ORCH_DONE__: {bad-json
      __ORCH_DONE__: {"status": "pending", "files_changed": ["e.ts"], "summary": "invalid status"}
      __ORCH_DONE__: {"status": "replan", "files_changed": ["f.ts"], "summary": "needs replanning"}
    `;
    const result = parseCompletionMarker(output);
    expect(result).toEqual({
      status: 'replan',
      files_changed: ['f.ts'],
      summary: 'needs replanning',
    });
  });

  it('handles empty input', () => {
    const result = parseCompletionMarker('');
    expect(result).toBeNull();
  });
});
