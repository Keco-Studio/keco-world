// Benchmark instrumentation layer: wall-clock latency measurement only. Nothing here enters canonical world state or hashes.

import type { RenderedPrompt } from "./prompt.js";

export interface DeliberationOutcome {
  choice: number | null;
  reason: string | null;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Error tag: "timeout" (abort), "network" (connection/DNS), "http:<code>" (status), "parse" (JSON), "range" (choice bounds), or null on success. */
  error: string | null;
}

export interface DeliberationRuntime {
  readonly name: string;
  readonly model: string;
  decide(p: RenderedPrompt, timeoutMs: number): Promise<DeliberationOutcome>;
}

function maxChoice(p: RenderedPrompt): number {
  const props = p.schema["properties"] as Record<string, { maximum?: number }> | undefined;
  return props?.["choice"]?.maximum ?? p.order.length;
}

export class OllamaRuntime implements DeliberationRuntime {
  readonly name = "ollama";
  constructor(
    readonly model: string,
    private readonly baseUrl = "http://localhost:11434",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async decide(p: RenderedPrompt, timeoutMs: number): Promise<DeliberationOutcome> {
    const started = Date.now();
    const fail = (error: string): DeliberationOutcome => ({
      choice: null, reason: null, latencyMs: Date.now() - started, tokensIn: 0, tokensOut: 0, error,
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: p.system },
            { role: "user", content: p.user },
          ],
          stream: false,
          format: p.schema,
          think: false,
          options: { temperature: 0, num_predict: 256 },
        }),
      });
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
      return fail(isTimeout ? "timeout" : "network");
    }
    if (!res.ok) return fail(`http:${res.status}`);
    let body: { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
    let parsed: { choice?: unknown; reason?: unknown };
    try {
      body = (await res.json()) as typeof body;
      parsed = JSON.parse(body.message?.content ?? "") as typeof parsed;
    } catch {
      return fail("parse");
    }
    const latencyMs = Date.now() - started;
    const tokensIn = body.prompt_eval_count ?? 0;
    const tokensOut = body.eval_count ?? 0;
    const choice = parsed.choice;
    if (typeof choice !== "number" || !Number.isInteger(choice)) {
      return { choice: null, reason: null, latencyMs, tokensIn, tokensOut, error: "parse" };
    }
    if (choice < 1 || choice > maxChoice(p)) {
      return { choice: null, reason: null, latencyMs, tokensIn, tokensOut, error: "range" };
    }
    return {
      choice,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
      latencyMs, tokensIn, tokensOut, error: null,
    };
  }
}

/** Test double — never touches the network. */
export class MockRuntime implements DeliberationRuntime {
  readonly name = "mock";
  readonly model = "mock";
  constructor(private readonly pick: (p: RenderedPrompt) => number | null) {}
  async decide(p: RenderedPrompt, _timeoutMs: number): Promise<DeliberationOutcome> {
    const choice = this.pick(p);
    if (choice === null) {
      return { choice: null, reason: null, latencyMs: 0, tokensIn: 0, tokensOut: 0, error: "parse" };
    }
    return { choice, reason: "mock", latencyMs: 0, tokensIn: 0, tokensOut: 0, error: null };
  }
}
