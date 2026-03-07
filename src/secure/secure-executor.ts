export interface SecureExecutor {
  prepareEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  networkAllowed(taskAllowsNetwork?: boolean): boolean;
  modeName(): string;
}