import { HostExecutor } from "./host-executor.js";

export class ContainerExecutor extends HostExecutor {
  public override networkAllowed(taskAllowsNetwork: boolean): boolean {
    return taskAllowsNetwork;
  }

  public override modeName(): string {
    return "container";
  }
}
