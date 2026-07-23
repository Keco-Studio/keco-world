import { describe, it, expect } from "vitest";
import { fmtDays, riskLine, verbLabel, buildWhyCard, eventLine, patronMark, DAY_TICKS } from "../web/src/viewmodel.js";

describe("shell viewmodel", () => {
  it("formats days and verbs in Chinese", () => {
    expect(DAY_TICKS).toBe(100);
    expect(fmtDays(130)).toBe("1.3 天");
    expect(verbLabel("forage")).toBe("采集");
    expect(verbLabel("idle")).toBe("歇息");
  });
  it("risk line matches the §4.2 register", () => {
    const line = riskLine({ npcId: "npc-1", tick: 300, score: 0, ticksToWinter: 160, reserves: 180, shortfall: 620, kind: "winter-shortfall" }, 2);
    expect(line).toContain("冬天还有 1.6 天");
    expect(line).toContain("0.9 天");
  });
  it("why card is grounded in the decision record", () => {
    const info = {
      tick: 5, npcId: "npc-1", observation: {} as never, actionSource: "resolver" as const,
      action: { verb: "move" } as never,
      candidates: [
        { key: "explore", score: 400, action: { verb: "move" } },
        { key: "forage", score: 390, action: { verb: "move" } },
      ] as never,
      chosenKey: "explore" as const, patronApplied: true, patronDecisive: true,
    };
    const npc = {
      identity: { riskTolerance: 500, socialTrust: 500, explorationBias: 900, patience: 200, voiceStyle: "" },
      beliefs: [
        { proposition: "远方总有新的浆果丛", effect: { target: "w:explore", modifier: 150, condition: null }, confidence: 700, source: "designed", acquiredTick: 0, decayPer100: 0 },
        { proposition: "冬季闭户", effect: { target: "w:shelter", modifier: 250, condition: "winter" }, confidence: 950, source: "designed", acquiredTick: 0, decayPer100: 0 },
      ], energy: 800, policy: { thresholds: { hungerUrgent: 150 } },
    };
    const card = buildWhyCard(info as never, npc as never, "summer");
    expect(card.candidates[0]!.label).toBe("探索");
    expect(card.candidates[0]!.chosen).toBe(true);
    expect(card.experience).toContain("『远方总有新的浆果丛』");
    expect(card.experience).not.toContain("『冬季闭户』"); // winter-gated belief hidden in summer
    expect(card.sourceLine).toContain("犹豫");
    expect(card.sourceLine).toContain(patronMark("explore"));
  });
  it("event lines cover the player-facing kinds", () => {
    const names = new Map([["npc-1", "Rill"]]);
    expect(eventLine({ tick: 1, kind: "birth", npcId: "npc-1", data: {} }, names)).toContain("Rill");
    expect(eventLine({ tick: 1, kind: "season_change", npcId: null, data: { season: "winter" } }, names)).toContain("冬");
    expect(eventLine({ tick: 1, kind: "patron_set", npcId: "npc-1", data: { theme: "explore" } }, names)).toContain("守望");
    // death events carry cause on the "cause" field (see src/world/rules.ts: `npc.deathCause = npc.lastDamage ?? "unknown"`,
    // pushed into SemanticEvent.data.cause) — the Chinese line must translate known cause codes,
    // matching src/chronicle/biography.ts's DEATH_CAUSE_PHRASE wording, not leak the raw English code.
    const deathLine = eventLine({ tick: 1, kind: "death", npcId: "npc-1", data: { cause: "wolf" } }, names);
    expect(deathLine).toContain("Rill");
    expect(deathLine).toContain("死于狼口");
    expect(deathLine).not.toContain("wolf");
  });
});
