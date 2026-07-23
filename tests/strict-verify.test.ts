import { describe, it, expect } from "vitest";
import { runSim } from "../src/sim/engine.js";
import { verifyStrict, verifyReplay, directivesToMap, directivesToFile } from "../src/replay/replay.js";
import { PatronDirectiveFileS } from "../src/schema/log.js";
import { makeDemoManifest, makeDemoRoster } from "../src/cli/demo.js";
import { hashCanonical } from "../src/canon/canonicalize.js";

const DIRS_FILE = [{ tick: 50, npcId: "npc-1", theme: "forage" as const }];

describe("strict verification", () => {
  const manifest = makeDemoManifest();
  const roster = makeDemoRoster("strict-t");
  const dirs = directivesToMap(PatronDirectiveFileS.parse(DIRS_FILE));
  const run = runSim(manifest, roster, "strict-t", { ticks: 400, patronDirectives: dirs });

  it("passes on an untampered patronized run", () => {
    const r = verifyStrict(manifest, roster, "strict-t", run.actionLog, run.checkpoints, 400, dirs);
    expect(r.ok).toBe(true);
    expect(r.eventCountProvided).toBe(r.eventCountRegenerated);
  });

  it("catches a fully re-chained annotation flip that injected replay accepts", () => {
    // Flip patronDecisive on a decisive event (or patronInfluence on any event), then re-stitch
    // the entire hash chain so the log is internally consistent.
    const tampered = structuredClone(run.actionLog);
    const idx = tampered.findIndex((e) => e.patronInfluence);
    expect(idx).toBeGreaterThanOrEqual(0);
    tampered[idx]!.patronInfluence = false;
    tampered[idx]!.patronDecisive = false;
    // re-chain from idx onward
    for (let i = idx; i < tampered.length; i++) {
      tampered[i]!.previousEventHash = i === 0 ? null : hashCanonical(tampered[i - 1]!);
    }
    // Injected replay passes (documented blind spot):
    const rep = verifyReplay(manifest, roster, "strict-t", tampered, run.checkpoints, 400, dirs);
    expect(rep.ok).toBe(true);
    // Strict catches it:
    const strict = verifyStrict(manifest, roster, "strict-t", tampered, run.checkpoints, 400, dirs);
    expect(strict.ok).toBe(false);
    expect(strict.firstDivergentEventIndex).toBe(idx);
    expect(strict.firstDivergentEventTick).toBe(run.actionLog[idx]!.tick);
  });

  it("catches directive omission (regenerated log lacks tilted trajectory)", () => {
    const strict = verifyStrict(manifest, roster, "strict-t", run.actionLog, run.checkpoints, 400, undefined);
    expect(strict.ok).toBe(false);
  });

  it("directive codec round-trips and sorts deterministically", () => {
    const file = directivesToFile(dirs);
    expect(file).toEqual(DIRS_FILE);
    expect(directivesToFile(directivesToMap(file))).toEqual(file);
    expect(directivesToFile(undefined)).toEqual([]);
  });
});
