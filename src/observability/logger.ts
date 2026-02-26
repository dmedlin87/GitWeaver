export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  ts: string;
  context?: Record<string, unknown>;
}

export class Logger {
  private readonly debugEnabled: boolean;

  public constructor(debugEnabled = false) {
    this.debugEnabled = debugEnabled;
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    if (!this.debugEnabled) {
      return;
    }
    this.log({ level: "debug", message, ts: new Date().toISOString(), context });
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.log({ level: "info", message, ts: new Date().toISOString(), context });
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.log({ level: "warn", message, ts: new Date().toISOString(), context });
  }

  public error(message: string, context?: Record<string, unknown>): void {
    this.log({ level: "error", message, ts: new Date().toISOString(), context });
  }

  private log(entry: LogEntry): void {
    const payload = entry.context ? { ...entry, context: entry.context } : entry;
    const line = JSON.stringify(payload);
    if (entry.level === "error") {
      console.error(line);
      return;
    }
    if (entry.level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  }
}