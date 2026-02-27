import { ContainerExecutor } from "./container-executor.js";
import { HostExecutor } from "./host-executor.js";
import type { SecureExecutor } from "./secure-executor.js";

export function createSecureExecutor(mode: "host" | "container"): SecureExecutor {
  if (mode === "container") {
    return new ContainerExecutor();
  }
  return new HostExecutor();
}
