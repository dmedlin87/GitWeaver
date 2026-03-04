import { describe, expect, it } from "vitest";
import { sha256, stableStringify } from "../../src/core/hash.js";

describe("sha256", () => {
  it("computes correct hash for known input", () => {
    // sha256("hello")
    const expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    expect(sha256("hello")).toBe(expected);
  });

  it("handles empty string", () => {
    // sha256("")
    const expected = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256("")).toBe(expected);
  });

  it("is deterministic", () => {
    const input = "test-input-string";
    expect(sha256(input)).toBe(sha256(input));
  });
});

describe("stableStringify", () => {
  it("sorts object keys alphabetically", () => {
    const input = { b: 1, a: 2, c: 3 };
    const output = stableStringify(input);
    expect(output).toBe('{"a":2,"b":1,"c":3}');
  });

  it("sorts nested object keys", () => {
    const input = {
      z: { y: 1, x: 2 },
      a: { c: 3, b: 4 }
    };
    const output = stableStringify(input);
    expect(output).toBe('{"a":{"b":4,"c":3},"z":{"x":2,"y":1}}');
  });

  it("preserves array order", () => {
    const input = [3, 1, 2];
    const output = stableStringify(input);
    expect(output).toBe('[3,1,2]');
  });

  it("handles arrays of objects", () => {
    const input = [{ b: 1, a: 2 }, { d: 3, c: 4 }];
    const output = stableStringify(input);
    expect(output).toBe('[{"a":2,"b":1},{"c":4,"d":3}]');
  });

  it("handles primitives", () => {
    expect(stableStringify(123)).toBe("123");
    expect(stableStringify("abc")).toBe('"abc"');
    expect(stableStringify(true)).toBe("true");
    expect(stableStringify(null)).toBe("null");
  });

  it("handles undefined by throwing an error", () => {
    // stableStringify explicitly forbids undefined to ensure deterministic string outputs
    expect(() => stableStringify(undefined)).toThrow("Cannot stableStringify undefined");
  });

  it("handles an object containing undefined values by ignoring them during JSON.stringify", () => {
    const input = { a: 1, b: undefined, c: 3 };
    const output = stableStringify(input);
    expect(output).toBe('{"a":1,"c":3}');
  });

  it("handles complex mixed structure", () => {
    const input = {
      list: [
        { id: 2, val: "b" },
        { id: 1, val: "a" }
      ],
      meta: {
        date: "2023-01-01",
        tags: ["z", "a"]
      }
    };
    const output = stableStringify(input);
    // Keys in 'input' sorted: list, meta
    // Keys in objects in 'list' sorted: id, val
    // Keys in 'meta' sorted: date, tags
    // Arrays preserved: list order kept, tags order kept
    const expected = '{"list":[{"id":2,"val":"b"},{"id":1,"val":"a"}],"meta":{"date":"2023-01-01","tags":["z","a"]}}';
    expect(output).toBe(expected);
  });
});
