// Judge-packet CLI (docs/prereg-1c-draft.md §4/§9-2): reads archived formal-runner
// dirs (Task 1, `<out>/<arm>/<seedRoot>/`) for the evolutionary and handcrafted arms,
// samples/pairs/blinds candidate biographies, and writes a printable packet.html plus
// a separate (never bundled into the packet) answer-key.json.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { z } from "zod";
import type { WorldManifest, RosterEntry } from "../schema/core.js";
import { WorldManifestS, RosterEntryS } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import { SemanticEventS } from "../schema/log.js";
import type { WorldState } from "../world/state.js";
import { extractLineage } from "../chronicle/extract.js";
import { stratifiedSelect } from "../chronicle/sample.js";
import { renderBiography } from "../chronicle/biography.js";
import { pickLineages, buildPairs, blindingViolations } from "../eval/pairing.js";
import type { BioCandidate, EvalPair } from "../eval/pairing.js";

interface SeedArtifacts {
  manifest: WorldManifest;
  roster: RosterEntry[];
  events: SemanticEvent[];
  finalState: WorldState;
}

function loadSeedArtifacts(seedDir: string): SeedArtifacts {
  const manifest = WorldManifestS.parse(JSON.parse(readFileSync(join(seedDir, "manifest.json"), "utf8")));
  const roster = z.array(RosterEntryS).parse(JSON.parse(readFileSync(join(seedDir, "roster.json"), "utf8")));
  const eventsText = gunzipSync(readFileSync(join(seedDir, "events.jsonl.gz"))).toString("utf8");
  const events = eventsText
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => SemanticEventS.parse(JSON.parse(l)));
  const finalState = JSON.parse(gunzipSync(readFileSync(join(seedDir, "final-state.json.gz"))).toString("utf8")) as WorldState;
  return { manifest, roster, events, finalState };
}

/** Builds candidate biographies for every seed archived under `<outDir>/<arm>`:
 * pickLineages -> extractLineage -> stratifiedSelect -> renderBiography(selection). */
export function buildCandidatesForArm(outDir: string, arm: string): BioCandidate[] {
  const armDir = join(outDir, arm);
  const seedRoots = readdirSync(armDir).filter((name) => statSync(join(armDir, name)).isDirectory());
  const candidates: BioCandidate[] = [];
  for (const seedRoot of seedRoots) {
    const { manifest, roster, events, finalState } = loadSeedArtifacts(join(armDir, seedRoot));
    const lineageIds = pickLineages(events, finalState, roster, seedRoot);
    for (const lineageId of lineageIds) {
      const chronicle = extractLineage(events, finalState, roster, lineageId);
      const selection = stratifiedSelect(chronicle);
      const text = renderBiography(chronicle, manifest, selection);
      candidates.push({ arm, seedRoot, lineageId, peakGeneration: chronicle.peakGeneration, text });
    }
  }
  return candidates;
}

export interface EvalPacketResult {
  pairs: EvalPair[];
  answerKey: Record<string, "left" | "right">;
}

/** Builds the full packet: candidates for both arms, hard-errors on any blinding
 * violation (grep list + each candidate's own seedRoot, so the seed string itself
 * can never leak), then pairs and truncates to `maxPairs`. */
export function buildEvalPacket(outDir: string, arms: string[], pairingSeed: string, maxPairs: number): EvalPacketResult {
  if (arms.length !== 2 || !arms.includes("evolutionary") || !arms.includes("handcrafted")) {
    throw new Error(`evalpack: --arms must be exactly "evolutionary,handcrafted" (any order), got "${arms.join(",")}"`);
  }

  const evoCandidates = buildCandidatesForArm(outDir, "evolutionary");
  const handCandidates = buildCandidatesForArm(outDir, "handcrafted");

  const violationsByCandidate = new Map<string, string[]>();
  for (const c of [...evoCandidates, ...handCandidates]) {
    const v = blindingViolations(c.text, c.seedRoot);
    if (v.length > 0) violationsByCandidate.set(`${c.arm}/${c.seedRoot}/${c.lineageId}`, v);
  }
  if (violationsByCandidate.size > 0) {
    const lines = [...violationsByCandidate.entries()].map(([key, terms]) => `  ${key}: ${terms.join(", ")}`);
    throw new Error(`evalpack: blinding violations found in ${violationsByCandidate.size} candidate(s):\n${lines.join("\n")}`);
  }

  const allPairs = buildPairs(evoCandidates, handCandidates, pairingSeed);
  const pairs = allPairs.slice(0, maxPairs);

  const answerKey: Record<string, "left" | "right"> = {};
  for (const p of pairs) answerKey[p.pairId] = p.leftIsEvolutionary ? "left" : "right";

  return { pairs, answerKey };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Printable, JS-free packet: one section per pair, two labeled <pre> columns
 * (甲/乙, never "left/right" or "evolutionary/handcrafted"), and the single
 * blinded question with a paper-checkbox-style answer placeholder. */
export function renderPacketHtml(pairs: EvalPair[]): string {
  const sections = pairs
    .map(
      (p, i) => `  <section class="pair">
    <h2>第 ${i + 1} 组</h2>
    <div class="columns">
      <div class="col">
        <h3>甲</h3>
        <pre>${escapeHtml(p.left.text)}</pre>
      </div>
      <div class="col">
        <h3>乙</h3>
        <pre>${escapeHtml(p.right.text)}</pre>
      </div>
    </div>
    <p class="question">更想继续看哪条血脉的后续？&emsp;( &nbsp;) 甲&emsp;( &nbsp;) 乙</p>
  </section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>血脉传记评审问卷</title>
<style>
  body { font-family: "Songti SC", "SimSun", serif; max-width: 1000px; margin: 2em auto; padding: 0 1em; }
  .pair { page-break-after: always; border-bottom: 1px solid #ccc; padding-bottom: 2em; margin-bottom: 2em; }
  .columns { display: flex; gap: 2em; }
  .col { flex: 1; min-width: 0; }
  pre { white-space: pre-wrap; font-family: inherit; }
  .question { font-weight: bold; margin-top: 1em; font-size: 1.1em; }
</style>
</head>
<body>
${sections}
</body>
</html>
`;
}

// Guard against CLI execution during test imports
if (process.argv[1]?.endsWith("evalpack.ts") || process.argv[1]?.endsWith("evalpack.js")) {
  function arg(name: string, fallback: string): string {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback;
  }

  const outDir = arg("out", join("runs", "formal"));
  const arms = arg("arms", "evolutionary,handcrafted")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const maxPairs = parseInt(arg("pairs", "25"), 10);
  const packetDir = arg("packet", join("runs", "evalpack"));
  // Fixed pairing-level seed for the left/right blinding draw -- distinct from any
  // world/arm seedRoot, kept as a CLI override for reproducing a specific packet.
  const pairingSeed = arg("seed", "evalpack-v1");

  const { pairs, answerKey } = buildEvalPacket(outDir, arms, pairingSeed, maxPairs);

  mkdirSync(packetDir, { recursive: true });
  writeFileSync(join(packetDir, "packet.html"), renderPacketHtml(pairs));
  writeFileSync(join(packetDir, "answer-key.json"), JSON.stringify(answerKey, null, 2));

  console.log(`=== Eval Packet ===`);
  console.log(`arms: ${arms.join(", ")}`);
  console.log(`pairs: ${pairs.length}`);
  console.log(`Output: ${packetDir}`);
}
