import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSim } from "../sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { narrate } from "./narrate.js";
import { SCHEMA_VERSION } from "../schema/core.js";
import { CANON_VERSION } from "../canon/canonicalize.js";
import { RNG_SCHEME_VERSION } from "../rng/rng.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
}

const seedRoot = arg("seed", "demo-seed");
const ticks = parseInt(arg("ticks", "1200"), 10);
const outDir = arg("out", join("runs", `${seedRoot}-${ticks}`));

const manifest = makeDemoManifest();
const roster = makeDemoRoster(seedRoot);
const result = runSim(manifest, roster, seedRoot, { ticks });

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "roster.json"), JSON.stringify(roster, null, 2));
writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify({ seedRoot, ticks, schemaVersion: SCHEMA_VERSION, canonVersion: CANON_VERSION, rngSchemeVersion: RNG_SCHEME_VERSION }, null, 2),
);
writeFileSync(join(outDir, "actions.jsonl"), result.actionLog.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(join(outDir, "checkpoints.json"), JSON.stringify(result.checkpoints, null, 2));
writeFileSync(join(outDir, "events.jsonl"), result.events.map((e) => JSON.stringify(e)).join("\n") + "\n");

const names = new Map(roster.map((r) => [r.npcId, r.name]));
const alive = result.finalState.npcs.filter((n) => n.alive).length;
console.log(`Simulated ${ticks} ticks, seed "${seedRoot}" → ${outDir}`);
console.log(`Alive: ${alive}/${roster.length}, actions: ${result.actionLog.length}, checkpoints: ${result.checkpoints.length}`);
console.log("--- events ---");
for (const ev of result.events) console.log(narrate(ev, names));
