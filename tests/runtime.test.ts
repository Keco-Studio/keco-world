import { describe, it, expect } from "vitest";
import { OllamaRuntime, MockRuntime } from "../src/bench/runtime.js";
import type { RenderedPrompt } from "../src/bench/prompt.js";

const prompt: RenderedPrompt = {
  system: "sys",
  user: "user",
  schema: { type: "object", properties: { choice: { type: "integer", minimum: 1, maximum: 3 }, reason: { type: "string" } }, required: ["choice", "reason"] },
  order: [2, 0, 1],
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("OllamaRuntime", () => {
  it("parses a valid response with usage", async () => {
    const rt = new OllamaRuntime("qwen3:0.6b", "http://x", fakeFetch({
      message: { content: '{"choice": 2, "reason": "safer"}' },
      prompt_eval_count: 120,
      eval_count: 15,
    }));
    const r = await rt.decide(prompt, 5000);
    expect(r).toMatchObject({ choice: 2, reason: "safer", tokensIn: 120, tokensOut: 15, error: null });
  });
  it("rejects out-of-range choices as error 'range'", async () => {
    const rt = new OllamaRuntime("m", "http://x", fakeFetch({ message: { content: '{"choice": 9, "reason": "x"}' } }));
    const r = await rt.decide(prompt, 5000);
    expect(r.choice).toBeNull();
    expect(r.error).toBe("range");
  });
  it("tags unparseable content as 'parse'", async () => {
    const rt = new OllamaRuntime("m", "http://x", fakeFetch({ message: { content: "I think option 2" } }));
    const r = await rt.decide(prompt, 5000);
    expect(r.error).toBe("parse");
  });
  it("tags non-2xx as http error", async () => {
    const rt = new OllamaRuntime("m", "http://x", fakeFetch({}, 500));
    const r = await rt.decide(prompt, 5000);
    expect(r.error).toBe("http:500");
  });
  it("sends think:false, temperature 0, and the schema as format", async () => {
    let captured: unknown;
    const spy: typeof fetch = (async (_url: unknown, init?: RequestInit) => {
      captured = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ message: { content: '{"choice":1,"reason":"r"}' } }), { status: 200 });
    }) as unknown as typeof fetch;
    await new OllamaRuntime("qwen3:4b", "http://x", spy).decide(prompt, 5000);
    const b = captured as Record<string, unknown>;
    expect(b["think"]).toBe(false);
    expect((b["options"] as Record<string, unknown>)["temperature"]).toBe(0);
    expect(b["format"]).toEqual(prompt.schema);
    expect(b["model"]).toBe("qwen3:4b");
    expect(b["stream"]).toBe(false);
  });
});

describe("MockRuntime", () => {
  it("returns the configured pick with zero latency accounting", async () => {
    const rt = new MockRuntime(() => 3);
    const r = await rt.decide(prompt, 1000);
    expect(r.choice).toBe(3);
    expect(r.error).toBeNull();
  });
  it("null pick becomes a parse failure", async () => {
    const rt = new MockRuntime(() => null);
    const r = await rt.decide(prompt, 1000);
    expect(r.choice).toBeNull();
    expect(r.error).toBe("parse");
  });
});
