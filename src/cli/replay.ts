import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyReplay } from "../replay/replay.js";
import { verifyLogChain } from "../sim/engine.js";
import { WorldManifestS, RosterEntryS, SCHEMA_VERSION } from "../schema/core.js";
import { CanonicalActionEventS, CheckpointS } from "../schema/log.js";
import { CANON_VERSION } from "../canon/canonicalize.js";
import { RNG_SCHEME_VERSION } from "../rng/rng.js";
import { z } from "zod";

const runDir = process.argv[2];
if (runDir === undefined) {
  console.error("usage: npm run replay -- <runDir>");
  process.exit(2);
}

const MetaS = z
  .object({
    seedRoot: z.string(),
    ticks: z.number().int().min(1),
    schemaVersion: z.literal(SCHEMA_VERSION),
    canonVersion: z.literal(CANON_VERSION),
    rngSchemeVersion: z.literal(RNG_SCHEME_VERSION),
  })
  .strict();

const manifest = WorldManifestS.parse(JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8")));
const roster = z.array(RosterEntryS).parse(JSON.parse(readFileSync(join(runDir, "roster.json"), "utf8")));
const meta = MetaS.parse(JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8")));
const actionLog = readFileSync(join(runDir, "actions.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.length > 0)
  .map((l) => CanonicalActionEventS.parse(JSON.parse(l)));
const checkpoints = z.array(CheckpointS).parse(JSON.parse(readFileSync(join(runDir, "checkpoints.json"), "utf8")));

const chainOk = verifyLogChain(actionLog);
const report = verifyReplay(manifest, roster, meta.seedRoot, actionLog, checkpoints, meta.ticks);
console.log(`log chain: ${chainOk ? "OK" : "BROKEN"}`);
console.log(`replay: ${report.ok ? "OK" : "DIVERGED"} (${report.checkpointCount} checkpoints)`);
if (!report.ok) {
  console.log(`first divergent checkpoint tick: ${report.firstDivergentCheckpoint}`);
  console.log(`first divergent tick: ${report.firstDivergentTick}`);
}
process.exit(chainOk && report.ok ? 0 : 1);
