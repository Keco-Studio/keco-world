import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runSim, type RunResult, type RunOptions } from "../sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { narrate } from "./narrate.js";
import { directivesToMap, directivesToFile } from "../replay/replay.js";
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import { SCHEMA_VERSION } from "../schema/core.js";
import { PatronDirectiveFileS } from "../schema/log.js";
import { CANON_VERSION } from "../canon/canonicalize.js";
import { RNG_SCHEME_VERSION } from "../rng/rng.js";

export interface RunAndPersistOptions {
  seedRoot: string;
  ticks: number;
  outDir: string;
  /** Path to a JSON file matching `PatronDirectiveFileS`; omit for no patron directives. */
  directivesPath?: string;
}

export interface RunAndPersistResult {
  outDir: string;
  manifest: WorldManifest;
  roster: RosterEntry[];
  result: RunResult;
}

/** Runs the demo world and persists the full on-disk run-dir layout: manifest.json,
 * roster.json, meta.json, actions.jsonl, checkpoints.json, events.jsonl, and — always —
 * directives.json (the canonical sorted form of whatever patron directives were supplied,
 * `[]` when none), so every run dir this writes is explicit about its patron directives
 * and verifiable by `loadAndVerify` without special-casing. */
export function runAndPersist(opts: RunAndPersistOptions): RunAndPersistResult {
  const manifest = makeDemoManifest();
  const roster = makeDemoRoster(opts.seedRoot);

  let patronDirectives: RunOptions["patronDirectives"] | undefined;
  if (opts.directivesPath !== undefined) {
    const file = PatronDirectiveFileS.parse(JSON.parse(readFileSync(opts.directivesPath, "utf8")));
    patronDirectives = directivesToMap(file);
  }

  const result = runSim(manifest, roster, opts.seedRoot, { ticks: opts.ticks, patronDirectives });

  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(join(opts.outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(opts.outDir, "roster.json"), JSON.stringify(roster, null, 2));
  writeFileSync(
    join(opts.outDir, "meta.json"),
    JSON.stringify(
      { seedRoot: opts.seedRoot, ticks: opts.ticks, schemaVersion: SCHEMA_VERSION, canonVersion: CANON_VERSION, rngSchemeVersion: RNG_SCHEME_VERSION },
      null,
      2,
    ),
  );
  writeFileSync(join(opts.outDir, "actions.jsonl"), result.actionLog.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(opts.outDir, "checkpoints.json"), JSON.stringify(result.checkpoints, null, 2));
  writeFileSync(join(opts.outDir, "events.jsonl"), result.events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeFileSync(join(opts.outDir, "directives.json"), JSON.stringify(directivesToFile(patronDirectives), null, 2));

  return { outDir: opts.outDir, manifest, roster, result };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }
  function optionalArg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : undefined;
  }

  const seedRoot = arg("seed", "demo-seed");
  const ticks = parseInt(arg("ticks", "1200"), 10);
  const outDir = arg("out", join("runs", `${seedRoot}-${ticks}`));
  const directivesPath = optionalArg("directives");

  const { result, roster } = runAndPersist({ seedRoot, ticks, outDir, directivesPath });

  const names = new Map(roster.map((r) => [r.npcId, r.name]));
  const alive = result.finalState.npcs.filter((n) => n.alive).length;
  console.log(`Simulated ${ticks} ticks, seed "${seedRoot}" → ${outDir}`);
  console.log(`Alive: ${alive}/${roster.length}, actions: ${result.actionLog.length}, checkpoints: ${result.checkpoints.length}`);
  console.log("--- events ---");
  for (const ev of result.events) console.log(narrate(ev, names));
}
