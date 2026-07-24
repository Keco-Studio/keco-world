import { describe, it, expect } from "vitest";
import { pickLineages, buildPairs, blindingViolations } from "../src/eval/pairing.js";
import type { BioCandidate } from "../src/eval/pairing.js";
import type { RosterEntry } from "../src/schema/core.js";
import type { SemanticEvent } from "../src/schema/log.js";
import type { WorldState, NpcState } from "../src/world/state.js";
import { drawInt } from "../src/rng/rng.js";

function roster(npcId: string): RosterEntry {
  return {
    npcId,
    name: npcId,
    identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "" },
    policy: {
      utilityWeights: { forage: 600, consume: 800, shelter: 700, seekMate: 500, explore: 200, idle: 50 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 60,
    },
    beliefs: [],
  };
}

function npc(npcId: string, lineageId: string, generation: number, alive: boolean): NpcState {
  return {
    npcId,
    name: npcId,
    pos: { x: 0, y: 0 },
    hp: 1000,
    energy: 1000,
    berries: 0,
    alive,
    deathTick: alive ? null : 1,
    deathCause: alive ? null : "old_age",
    lastDamage: null,
    identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 400, patience: 500, voiceStyle: "" },
    policy: {
      utilityWeights: { forage: 600, consume: 800, shelter: 700, seekMate: 500, explore: 200, idle: 50 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 60,
    },
    beliefs: [],
    birthTick: 0,
    generation,
    lineageId,
    parents: generation > 0 ? ["p1", "p2"] : null,
    reproCooldownUntil: 0,
    genomeHash: "x",
  };
}

function birthEvent(tick: number, npcId: string, lineageId: string, generation: number): SemanticEvent {
  return {
    tick,
    kind: "birth",
    npcId,
    data: { lineageId, generation, parentA: "p1", parentB: "p2" },
  };
}

function finalState(npcs: NpcState[]): WorldState {
  return { tick: 1000, npcs, bushes: [], wolf: { pos: { x: 0, y: 0 } }, patronThemes: {} };
}

describe("pickLineages", () => {
  it("picks the deepest survivor plus 2 deterministic draws, deduped", () => {
    const rosterEntries = [roster("f1"), roster("f2"), roster("f3"), roster("f4"), roster("f5")];
    // f3 has descendants down to generation 5; the rest never had births -> peakGeneration 0.
    const events: SemanticEvent[] = [];
    let tick = 1;
    let prev = "f3";
    for (let g = 1; g <= 5; g++) {
      const id = `f3-desc-${g}`;
      events.push(birthEvent(tick++, id, "f3", g));
      prev = id;
    }
    const npcs = [
      npc("f1", "f1", 0, true),
      npc("f2", "f2", 0, true),
      npc(prev, "f3", 5, true),
      npc("f4", "f4", 0, true),
      npc("f5", "f5", 0, false), // f5 extinct
    ];
    const state = finalState(npcs);

    const result = pickLineages(events, state, rosterEntries, "pick-seed-1");

    expect(result).toContain("f3"); // deepest survivor
    expect(new Set(result).size).toBe(result.length); // deduped
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result.length).toBeLessThanOrEqual(3);
    for (const id of result) expect(["f1", "f2", "f3", "f4"]).toContain(id);
    expect(result).not.toContain("f5");

    // deterministic
    expect(pickLineages(events, state, rosterEntries, "pick-seed-1")).toEqual(result);
  });

  it("returns all survivors when fewer than 3 survive", () => {
    const rosterEntries = [roster("f1"), roster("f2"), roster("f3")];
    const npcs = [npc("f1", "f1", 0, true), npc("f2", "f2", 0, true), npc("f3", "f3", 0, false)];
    const state = finalState(npcs);
    const result = pickLineages([], state, rosterEntries, "pick-seed-2");
    expect(result).toEqual(["f1", "f2"]);
  });
});

function candidate(arm: string, seedRoot: string, lineageId: string, peakGeneration: number, textLength: number): BioCandidate {
  return { arm, seedRoot, lineageId, peakGeneration, text: "x".repeat(textLength) };
}

describe("buildPairs", () => {
  it("matches within a peakGeneration band and redraws the Handcrafted side to satisfy ±20% length", () => {
    const evo = [candidate("evolutionary", "s1", "e-1", 5, 100)];
    // Deliberately fed out of sort order; buildPairs must sort internally.
    const hand = [
      candidate("handcrafted", "s1", "h-3", 5, 110), // fits: within ±20%
      candidate("handcrafted", "s1", "h-1", 5, 200), // too long
      candidate("handcrafted", "s1", "h-2", 5, 50), // too short
    ];

    const pairs = buildPairs(evo, hand, "pairing-seed-1");
    expect(pairs.length).toBe(1);
    const ids = [pairs[0]!.left.lineageId, pairs[0]!.right.lineageId];
    expect(ids).toContain("e-1");
    expect(ids).toContain("h-3");
  });

  it("does not pair candidates across different peakGeneration bands", () => {
    const evo = [candidate("evolutionary", "s1", "e-1", 5, 100)]; // band 0 (<=15)
    const hand = [candidate("handcrafted", "s1", "h-1", 20, 100)]; // band 1 (16-30)
    const pairs = buildPairs(evo, hand, "pairing-seed-2");
    expect(pairs.length).toBe(0);
  });

  it("assigns left/right via drawInt(seedRoot, 2, 'bio-side', pairId) deterministically", () => {
    const evo = [candidate("evolutionary", "s1", "e-1", 5, 100)];
    const hand = [candidate("handcrafted", "s1", "h-1", 5, 100)];

    const pairsA = buildPairs(evo, hand, "pairing-seed-3");
    const pairsB = buildPairs(evo, hand, "pairing-seed-3");
    expect(pairsB).toEqual(pairsA);

    const p = pairsA[0]!;
    const expectedLeftIsEvo = drawInt("pairing-seed-3", 2, "bio-side", p.pairId) === 0;
    expect(p.leftIsEvolutionary).toBe(expectedLeftIsEvo);
    if (p.leftIsEvolutionary) {
      expect(p.left.arm).toBe("evolutionary");
      expect(p.right.arm).toBe("handcrafted");
    } else {
      expect(p.left.arm).toBe("handcrafted");
      expect(p.right.arm).toBe("evolutionary");
    }
  });
});

describe("blindingViolations", () => {
  const FORBIDDEN = [
    "tick",
    "拍",
    "random",
    "fixed",
    "handcrafted",
    "evolutionary",
    "noculture",
    "算力",
    "代币",
    "模型",
    "锦标赛",
    "LoRA",
    "世界进化",
    "演变",
    "并无显著改变",
    "更热衷",
    "更疏于",
  ];

  it("catches each forbidden string", () => {
    for (const term of FORBIDDEN) {
      const text = `一段正常的传记文字，混入了 ${term} 这个词。`;
      expect(blindingViolations(text)).toContain(term);
    }
  });

  it("is case-insensitive for latin terms", () => {
    expect(blindingViolations("This mentions RANDOM in caps.")).toContain("random");
    expect(blindingViolations("Handcrafted with care.")).toContain("handcrafted");
  });

  it("passes a clean biography", () => {
    const clean = "Garen是这一脉的始祖，其血脉历经5代的繁衍。第2年夏，Garen信奉：『狼口即死，墙内即生』，时在第2年夏。";
    expect(blindingViolations(clean)).toEqual([]);
  });

  it("checks extra seedRoots passed in as additional arguments", () => {
    expect(blindingViolations("此文提到了 c1-evolutionary-3 这个种子。", "c1-evolutionary-3")).toContain(
      "c1-evolutionary-3",
    );
    // clean text is still clean when the extra seedRoot isn't present
    expect(blindingViolations("干净的文字。", "c1-evolutionary-3")).toEqual([]);
  });
});
