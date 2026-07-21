import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import { findTriggers, type TriggerPoint } from "./trigger.js";
import { renderPrompt } from "./prompt.js";
import { evaluatePair, actionsEqual } from "./rollout.js";
import { wilson, percentile } from "./stats.js";
import { drawInt } from "../rng/rng.js";
import type { DeliberationRuntime } from "./runtime.js";
import { hashCanonical } from "../canon/canonicalize.js";

export interface BenchParams {
  seeds: string[];
  ticks: number;
  epsilon: number;
  horizonTicks: number;
  timeoutMs: number;
  capPerSeed: number;
}

export interface TrialRecord {
  triggerId: string;
  model: string;
  displayChoice: number | null;
  chosenIndex: number | null;
  agreed: boolean | null;
  outcome: "win" | "loss" | "tie" | null;
  marginLlm: number | null;
  marginBest: number | null;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  error: string | null;
}

export interface ModelSummary {
  model: string;
  trials: number;
  failures: number;
  agreements: number;
  divergent: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: { p: number; lo: number; hi: number };
  latencyP50: number;
  latencyP95: number;
  tokensInMean: number;
  tokensOutMean: number;
  verdict: "gain" | "no-gain" | "insufficient-n";
}

/**
 * Deterministic even sampling across the full list: index k of `cap` maps to
 * floor(k * xs.length / cap), so the sample spans the entire input in order
 * instead of being biased toward the head (as a plain `.slice(0, cap)` would be).
 */
export function sampleEvenly<T>(xs: T[], cap: number): T[] {
  if (xs.length <= cap) return xs;
  const out: T[] = [];
  for (let k = 0; k < cap; k++) {
    out.push(xs[Math.floor((k * xs.length) / cap)]!);
  }
  return out;
}

export function harvestAll(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams,
): TriggerPoint[] {
  const all: TriggerPoint[] = [];
  for (const seed of params.seeds) {
    all.push(...sampleEvenly(findTriggers(manifest, roster, seed, params.ticks, params.epsilon), params.capPerSeed));
  }
  return all;
}

/** Fingerprint of everything that determines trial outcomes, for resume-safety (see runBenchForModel). */
function paramsFingerprint(manifest: WorldManifest, roster: RosterEntry[], params: BenchParams): string {
  return hashCanonical({
    marginVersion: "margin-v1",
    horizonTicks: params.horizonTicks,
    epsilon: params.epsilon,
    ticks: params.ticks,
    manifest,
    roster,
  });
}

function npcName(roster: RosterEntry[], npcId: string): string {
  return roster.find((r) => r.npcId === npcId)?.name ?? npcId;
}

function evaluateDivergent(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams,
  trigger: TriggerPoint, chosenIndex: number,
): Pick<TrialRecord, "outcome" | "marginLlm" | "marginBest"> {
  const pair = evaluatePair(
    manifest, roster, trigger,
    trigger.candidates[chosenIndex]!.action,
    trigger.candidates[trigger.bestIndex]!.action,
    params.horizonTicks,
  );
  return {
    outcome: pair.outcome === "A" ? "win" : pair.outcome === "B" ? "loss" : "tie",
    marginLlm: pair.marginA,
    marginBest: pair.marginB,
  };
}

export async function runBenchForModel(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams,
  triggers: TriggerPoint[], runtime: DeliberationRuntime,
  persistPath: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<TrialRecord[]> {
  const done = new Map<string, TrialRecord>();
  if (persistPath !== null) {
    const metaPath = `${persistPath}.meta.json`;
    const fingerprint = paramsFingerprint(manifest, roster, params);
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { fingerprint: string };
      if (meta.fingerprint !== fingerprint) {
        throw new Error(
          `Resume fingerprint mismatch at ${metaPath}: the persisted trials were produced with ` +
          `different params (horizonTicks/epsilon/ticks/manifest/roster). Resuming would silently ` +
          `mix incompatible rollout outcomes into this run. Use a fresh --out directory instead.`,
        );
      }
    } else {
      writeFileSync(metaPath, JSON.stringify({ fingerprint }) + "\n");
    }
    if (existsSync(persistPath)) {
      const lines = readFileSync(persistPath, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.length === 0) continue;
        try {
          const rec = JSON.parse(line) as TrialRecord;
          done.set(`${rec.model}|${rec.triggerId}`, rec);
        } catch {
          console.warn(
            `skipping malformed JSONL line ${i + 1} in ${persistPath} (likely a crash-truncated ` +
            `final write); its trial will re-run`,
          );
        }
      }
    }
  }
  const results: TrialRecord[] = [];
  let processed = 0;
  for (const trigger of triggers) {
    const key = `${runtime.model}|${trigger.id}`;
    const cached = done.get(key);
    if (cached !== undefined) {
      results.push(cached);
      onProgress?.(++processed, triggers.length);
      continue;
    }
    const prompt = renderPrompt(trigger, npcName(roster, trigger.npcId));
    const out = await runtime.decide(prompt, params.timeoutMs);
    let rec: TrialRecord;
    if (out.choice === null) {
      rec = {
        triggerId: trigger.id, model: runtime.model, displayChoice: null, chosenIndex: null,
        agreed: null, outcome: null, marginLlm: null, marginBest: null,
        latencyMs: out.latencyMs, tokensIn: out.tokensIn, tokensOut: out.tokensOut, error: out.error,
      };
    } else {
      const chosenIndex = prompt.order[out.choice - 1]!;
      const agreed = actionsEqual(
        trigger.candidates[chosenIndex]!.action,
        trigger.candidates[trigger.bestIndex]!.action,
      );
      rec = {
        triggerId: trigger.id, model: runtime.model, displayChoice: out.choice, chosenIndex,
        agreed,
        ...(agreed
          ? { outcome: null, marginLlm: null, marginBest: null }
          : evaluateDivergent(manifest, roster, params, trigger, chosenIndex)),
        latencyMs: out.latencyMs, tokensIn: out.tokensIn, tokensOut: out.tokensOut, error: null,
      };
    }
    if (persistPath !== null) appendFileSync(persistPath, JSON.stringify(rec) + "\n");
    results.push(rec);
    onProgress?.(++processed, triggers.length);
  }
  return results;
}

export function summarize(model: string, trials: TrialRecord[], minDivergent: number): ModelSummary {
  const failures = trials.filter((t) => t.error !== null).length;
  const agreements = trials.filter((t) => t.agreed === true).length;
  const wins = trials.filter((t) => t.outcome === "win").length;
  const losses = trials.filter((t) => t.outcome === "loss").length;
  const ties = trials.filter((t) => t.outcome === "tie").length;
  const divergent = wins + losses + ties;
  const decisive = wins + losses;
  const winRate = wilson(wins, decisive);
  const latencies = trials.map((t) => t.latencyMs);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const verdict: ModelSummary["verdict"] =
    decisive < minDivergent ? "insufficient-n"
    : winRate.p >= 0.55 && winRate.lo > 0.50 ? "gain"
    : "no-gain";
  return {
    model, trials: trials.length, failures, agreements, divergent, wins, losses, ties,
    winRate, latencyP50: percentile(latencies, 50), latencyP95: percentile(latencies, 95),
    tokensInMean: mean(trials.map((t) => t.tokensIn)), tokensOutMean: mean(trials.map((t) => t.tokensOut)),
    verdict,
  };
}

/** Deterministic control arm: a random non-best candidate, no LLM. Sanity floor. */
export function randomArmSummary(
  manifest: WorldManifest, roster: RosterEntry[], params: BenchParams, triggers: TriggerPoint[],
): ModelSummary {
  const trials: TrialRecord[] = triggers.map((trigger) => {
    const n = trigger.candidates.length;
    const offset = drawInt(trigger.seedRoot, n - 1, "randarm", trigger.id);
    const chosenIndex = (trigger.bestIndex + 1 + offset) % n;
    const agreed = actionsEqual(
      trigger.candidates[chosenIndex]!.action,
      trigger.candidates[trigger.bestIndex]!.action,
    );
    return {
      triggerId: trigger.id, model: "random-control", displayChoice: null, chosenIndex,
      agreed,
      ...(agreed
        ? { outcome: null, marginLlm: null, marginBest: null }
        : evaluateDivergent(manifest, roster, params, trigger, chosenIndex)),
      latencyMs: 0, tokensIn: 0, tokensOut: 0, error: null,
    };
  });
  return summarize("random-control", trials, 1);
}
