import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { verifyReplay, verifyStrict, directivesToMap, type ReplayReport, type StrictReport } from "../replay/replay.js";
import { verifyLogChain, type RunOptions } from "../sim/engine.js";
import { WorldManifestS, RosterEntryS, SCHEMA_VERSION } from "../schema/core.js";
import { CanonicalActionEventS, CheckpointS, PatronDirectiveFileS } from "../schema/log.js";
import { CANON_VERSION } from "../canon/canonicalize.js";
import { RNG_SCHEME_VERSION } from "../rng/rng.js";
import { z } from "zod";

const MetaS = z
  .object({
    seedRoot: z.string(),
    ticks: z.number().int().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    canonVersion: z.literal(CANON_VERSION),
    rngSchemeVersion: z.literal(RNG_SCHEME_VERSION),
  })
  .strict();

export interface LoadAndVerifyOptions {
  /** Also run Layer-2 (`verifyStrict`) verification — a full no-injection re-simulation
   * compared against the provided log/checkpoints, which additionally catches tampering
   * with the annotation fields (`actionSource`/`patronInfluence`/`patronDecisive`) that
   * injected replay alone cannot see (doc §3.4). */
  strict?: boolean;
}

export interface LoadAndVerifyOutcome {
  chainOk: boolean;
  replayReport: ReplayReport;
  strictReport: StrictReport | null;
  /** true only when every requested check passed (log chain + replay, and strict when requested). */
  ok: boolean;
}

/** Loads a run dir's artifacts (manifest/roster/meta/actions/checkpoints, and —
 * when present — `directives.json`; absent is fine and yields `undefined` patron
 * directives with no error, so run dirs written before this feature stay verifiable)
 * and runs the requested verification checks, printing the labeled verdicts. */
export function loadAndVerify(runDir: string, opts: LoadAndVerifyOptions = {}): LoadAndVerifyOutcome {
  const manifest = WorldManifestS.parse(JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8")));
  const roster = z.array(RosterEntryS).parse(JSON.parse(readFileSync(join(runDir, "roster.json"), "utf8")));
  const meta = MetaS.parse(JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")));
  const actionLog = readFileSync(join(runDir, "actions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => CanonicalActionEventS.parse(JSON.parse(l)));
  const checkpoints = z.array(CheckpointS).parse(JSON.parse(readFileSync(join(runDir, "checkpoints.json"), "utf8")));

  const directivesPath = join(runDir, "directives.json");
  let patronDirectives: RunOptions["patronDirectives"] | undefined;
  if (existsSync(directivesPath)) {
    const file = PatronDirectiveFileS.parse(JSON.parse(readFileSync(directivesPath, "utf8")));
    patronDirectives = directivesToMap(file);
  }

  const chainOk = verifyLogChain(actionLog);
  const replayReport = verifyReplay(manifest, roster, meta.seedRoot, actionLog, checkpoints, meta.ticks, patronDirectives);
  const strictReport =
    opts.strict === true
      ? verifyStrict(manifest, roster, meta.seedRoot, actionLog, checkpoints, meta.ticks, patronDirectives)
      : null;

  console.log(`log chain: ${chainOk ? "OK" : "BROKEN"}`);
  console.log(`replay: ${replayReport.ok ? "OK" : "DIVERGED"} (${replayReport.checkpointCount} checkpoints)`);
  if (!replayReport.ok) {
    console.log(`first divergent checkpoint tick: ${replayReport.firstDivergentCheckpoint}`);
    console.log(`first divergent tick: ${replayReport.firstDivergentTick}`);
  }
  if (strictReport !== null) {
    console.log(`strict: ${strictReport.ok ? "OK" : "DIVERGED"} (${strictReport.eventCountProvided} events)`);
    if (!strictReport.ok) {
      console.log(`first divergent event index: ${strictReport.firstDivergentEventIndex}`);
      console.log(`first divergent event tick: ${strictReport.firstDivergentEventTick}`);
    }
  }

  const ok = chainOk && replayReport.ok && (strictReport === null || strictReport.ok);
  return { chainOk, replayReport, strictReport, ok };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("replay.ts") || process.argv[1]?.endsWith("replay.js")) {
  const runDir = process.argv[2];
  if (runDir === undefined || runDir.startsWith("--")) {
    console.error("usage: npm run replay -- <runDir> [--strict]");
    process.exit(2);
  }
  const strict = process.argv.includes("--strict");

  const outcome = loadAndVerify(runDir, { strict });
  process.exit(outcome.ok ? 0 : 1);
}
