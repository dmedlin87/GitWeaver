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
    const content = readFileSync(this.path, "utf8");
    const events: EventRecord[] = [];
    let start = 0;
    while (start < content.length) {
      const end = content.indexOf("\n", start);
      if (end === -1) {
        const line = content.substring(start).trim();
        if (line) {
          try {
            events.push(JSON.parse(line) as EventRecord);
          } catch {
            break;
          }
        }
        break;
      }
      const line = content.substring(start, end).trim();
      start = end + 1;
      if (line) {
        try {
          events.push(JSON.parse(line) as EventRecord);
        } catch {
          break;
        }
      }
    }
    return events;
  }
}
