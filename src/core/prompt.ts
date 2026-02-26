import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function promptYesNo(message: string, defaultValue = false): Promise<boolean> {
  const suffix = defaultValue ? "[Y/n]" : "[y/N]";
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const response = (await rl.question(`${message} ${suffix} `)).trim().toLowerCase();
    if (!response) {
      return defaultValue;
    }
    return response === "y" || response === "yes";
  } finally {
    rl.close();
  }
}