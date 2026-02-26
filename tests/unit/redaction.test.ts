import { describe, expect, it } from "vitest";
import { redactSensitive } from "../../src/observability/redaction.js";

describe("redactSensitive", () => {
  it("redacts OpenAI-style keys", () => {
    const input = "Here is my key: sk-abcdef1234567890abcdef1234567890 and more text";
    const output = redactSensitive(input);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("sk-abcdef1234567890abcdef1234567890");
    expect(output).toContain("Here is my key: [REDACTED] and more text");
  });

  it("redacts AWS access keys", () => {
    const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const output = redactSensitive(input);
    expect(output).toContain("AWS_ACCESS_KEY_ID=[REDACTED]");
    expect(output).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts generic tokens with keywords", () => {
    const inputs = [
      "api_token = abcdef12345678",
      "auth-token: abcdef12345678",
      "access token 'abcdef12345678'",
      "secret_token: abcdef12345678"
    ];
    for (const input of inputs) {
      const output = redactSensitive(input);
      expect(output).toContain("[REDACTED]");
      expect(output).not.toContain("abcdef12345678");
    }
  });

  it("supports extra patterns", () => {
    const input = "My secret code is 12345";
    const output = redactSensitive(input, [/12345/g]);
    expect(output).toBe("My secret code is [REDACTED]");
  });

  it("handles multiline input", () => {
    const input = `
      export OPENAI_API_KEY=sk-abcdef1234567890abcdef1234567890
      export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
    `;
    const output = redactSensitive(input);
    expect(output).toContain("OPENAI_API_KEY=[REDACTED]");
    expect(output).toContain("AWS_ACCESS_KEY_ID=[REDACTED]");
  });
});
