import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sha256, stableStringify } from "../core/hash.js";
import type { EventRecord } from "../core/types.js";

export class EventLog {
  private seq = 0;

  public constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const events = this.readAll();
      this.seq = events.length > 0 ? events[events.length - 1]!.seq : 0;
    }
  }

  public append(runId: string, type: string, payload: Record<string, unknown>): EventRecord {
    const record: EventRecord = {
      seq: this.seq + 1,
      runId,
      ts: new Date().toISOString(),
      type,
      payload,
      payloadHash: sha256(stableStringify(payload))
    };
    this.seq = record.seq;
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  public readAll(): EventRecord[] {
    if (!existsSync(this.path)) {
      return [];
    }
    return readFileSync(this.path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EventRecord);
  }
}
