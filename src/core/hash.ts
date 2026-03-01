import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    throw new Error("Cannot stableStringify undefined");
  }
  const str = JSON.stringify(sortValue(value));
  if (str === undefined) {
    throw new Error("Cannot stableStringify undefined");
  }
  return str;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}