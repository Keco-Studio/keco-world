import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runSim } from "../sim/engine.js";
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { extractLineage } from "../chronicle/extract.js";
import type { LineageChronicle } from "../chronicle/extract.js";
import { renderBiography } from "../chronicle/biography.js";

export interface BiographyIndexEntry {
  lineageId: string;
  founderName: string;
  members: number;
  peakGeneration: number;
  extinct: boolean;
}

export interface BiographyRunResult {
  chronicles: LineageChronicle[];
  index: BiographyIndexEntry[];
  biographies: Map<string, string>; // lineageId -> rendered markdown
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface BiographyOptions {
  lineage?: string; // founder npcId; if set, extract exactly this lineage
  top?: number; // top-N founder lineages by member count (ties: lineageId asc); default 1
}

/**
 * Rerun the demo world from the same roster path as evolve.ts, then extract either
 * a single named lineage or the top-N founder lineages by member count (founder +
 * every birth event carrying that lineageId), ties broken by lineageId ascending.
 */
export function runBiographies(seedRoot: string, ticks: number, opts: BiographyOptions = {}): BiographyRunResult {
  const manifest = makeDemoManifest();
  const roster = makeDemoRoster(seedRoot);
  const result = runSim(manifest, roster, seedRoot, { ticks, retainActionLog: false });

  let lineageIds: string[];
  if (opts.lineage !== undefined) {
    if (!roster.some((r) => r.npcId === opts.lineage)) {
      throw new Error(`runBiographies: no roster entry for lineageId "${opts.lineage}"`);
    }
    lineageIds = [opts.lineage];
  } else {
    const memberCounts = new Map<string, number>();
    for (const r of roster) memberCounts.set(r.npcId, 1); // founder counts as a member
    for (const e of result.events) {
      if (e.kind === "birth" && typeof e.data["lineageId"] === "string") {
        const lid = e.data["lineageId"] as string;
        memberCounts.set(lid, (memberCounts.get(lid) ?? 0) + 1);
      }
    }
    const top = opts.top ?? 1;
    lineageIds = roster
      .map((r) => r.npcId)
      .sort((a, b) => {
        const ca = memberCounts.get(a) ?? 0;
        const cb = memberCounts.get(b) ?? 0;
        if (ca !== cb) return cb - ca; // descending member count
        return compareIds(a, b); // tie: lineageId asc
      })
      .slice(0, top);
  }

  const chronicles = lineageIds.map((lid) => extractLineage(result.events, result.finalState, roster, lid));
  const index: BiographyIndexEntry[] = chronicles.map((c) => ({
    lineageId: c.lineageId,
    founderName: c.founderName,
    members: c.members.length,
    peakGeneration: c.peakGeneration,
    extinct: c.extinct,
  }));
  const biographies = new Map(chronicles.map((c) => [c.lineageId, renderBiography(c, manifest)] as const));

  return { chronicles, index, biographies };
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("biography.ts") || process.argv[1]?.endsWith("biography.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }
  function optionalArg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : undefined;
  }

  const seedRoot = arg("seed", "evo-seed");
  const ticks = parseInt(arg("ticks", "60000"), 10);
  const lineage = optionalArg("lineage");
  const topStr = optionalArg("top");
  const top = topStr !== undefined ? parseInt(topStr, 10) : undefined;
  const outDir = arg("out", join("runs", `biography-${seedRoot}`));

  const { index, biographies } = runBiographies(seedRoot, ticks, { lineage, top });

  mkdirSync(outDir, { recursive: true });

  for (const entry of index) {
    const md = biographies.get(entry.lineageId)!;
    writeFileSync(join(outDir, `${entry.founderName}.md`), md);
  }
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index, null, 2));

  console.log(`=== Biographies (seed: "${seedRoot}", ticks: ${ticks}) ===`);
  for (const entry of index) {
    console.log(
      `  ${entry.founderName.padEnd(10)} members=${String(entry.members).padEnd(4)} peakGeneration=${String(entry.peakGeneration).padEnd(4)} extinct=${entry.extinct}`,
    );
  }
  console.log(`\nOutput: ${outDir}`);
}
