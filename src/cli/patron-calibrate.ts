// Calibration CLI (Task 2, patron mechanism): sweeps candidate PATRON_TILT values and
// measures how often the tilt actually decides npc-1's hesitation-band lottery outcome
// (vs. merely participating in it), against the <=5% "decisive share" red line.
//
// A single live run per seed captures every onDecide firing for the target NPC (including
// its scored candidates); resolveWithTilt is then re-evaluated directly against that
// captured data for each candidate tilt value. This reuses the SAME seedRoot/npcId/tick key
// as the live run for every recomputation, so the underlying RNG draw is reproduced exactly
// as the engine would produce it for that tilt — the only simplification is that the
// candidate *sequence* itself (and which ticks are reflex vs. cognition decisions) is taken
// from one representative trajectory rather than re-simulating four full 5000-tick runs per
// seed; that is an acceptable simplification for this statistic, and dramatically cheaper.
import { makeDemoManifest, makeDemoRoster } from "./demo.js";
import { runSim, type DecideInfo } from "../sim/engine.js";
import { resolveWithTilt } from "../mind/resolver.js";
import type { UtilityKey } from "../schema/core.js";

const CANDIDATE_TILTS = [150, 100, 60, 30];
const SEEDS = ["patron-cal-1", "patron-cal-2", "patron-cal-3"];
const TICKS = 5000;
const THEME: UtilityKey = "explore";
const TARGET_NPC = "npc-1";
const RED_LINE_SHARE_1000 = 50; // <=5%

interface Row {
  seed: string;
  tilt: number;
  total: number;
  decisive: number;
  share1000: number;
  pass: boolean;
}

const manifest = makeDemoManifest();
const rows: Row[] = [];

for (const seed of SEEDS) {
  const roster = makeDemoRoster(seed);
  const target = roster.find((r) => r.npcId === TARGET_NPC);
  if (target === undefined) throw new Error(`roster for seed ${seed} has no ${TARGET_NPC}`);
  const identity = target.identity;
  const epsilon = target.policy.deliberationEpsilon;

  const decisions: DecideInfo[] = [];
  runSim(manifest, roster, seed, {
    ticks: TICKS,
    patronDirectives: new Map([[1, [{ npcId: TARGET_NPC, theme: THEME }]]]),
    onDecide: (info) => {
      if (info.npcId === TARGET_NPC) decisions.push(info);
    },
  });

  console.log(`seed ${seed}: captured ${decisions.length} decisions for ${TARGET_NPC}`);

  for (const tilt of CANDIDATE_TILTS) {
    let total = 0;
    let decisive = 0;
    for (const d of decisions) {
      total++;
      if (d.candidates === null) continue; // reflex decision: no band lottery, no tilt possible
      const r = resolveWithTilt(d.candidates, identity, epsilon, seed, TARGET_NPC, d.tick, THEME, tilt);
      if (r.patronDecisive) decisive++;
    }
    const share1000 = total > 0 ? Math.round((1000 * decisive) / total) : 0;
    rows.push({ seed, tilt, total, decisive, share1000, pass: share1000 <= RED_LINE_SHARE_1000 });
  }
}

console.log("");
console.log("tilt | seed           | total | decisive | decisiveShare1000 | <=50 (5%)?");
console.log("-----|----------------|-------|----------|--------------------|-----------");
for (const row of rows) {
  console.log(
    `${String(row.tilt).padStart(4)} | ${row.seed.padEnd(14)} | ${String(row.total).padStart(5)} | ${String(
      row.decisive,
    ).padStart(8)} | ${String(row.share1000).padStart(18)} | ${row.pass ? "PASS" : "FAIL"}`,
  );
}

let chosen: number | null = null;
for (const tilt of CANDIDATE_TILTS) {
  const tiltRows = rows.filter((r) => r.tilt === tilt);
  if (tiltRows.length === SEEDS.length && tiltRows.every((r) => r.pass)) {
    chosen = tilt;
    break;
  }
}

console.log("");
if (chosen !== null) {
  console.log(`chosen PATRON_TILT = ${chosen} (largest candidate passing on all ${SEEDS.length} seeds)`);
  process.exit(0);
} else {
  console.log("no candidate tilt passed the <=5% red line on all seeds");
  process.exit(1);
}
