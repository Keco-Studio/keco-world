import { describe, it, expect } from "vitest";
import { createFlow, flowReduce } from "../web/src/flow.js";

describe("five-minute flow state machine", () => {
  it("walks the interaction-gated beats in order and ignores invalid events", () => {
    let f = createFlow("npc-1");
    expect(f.beat).toBe("opening");
    f = flowReduce(f, { type: "choose-theme", theme: "explore" }); // invalid now
    expect(f.beat).toBe("opening");
    f = flowReduce(f, { type: "dismiss-opening" });
    expect(f.beat).toBe("watching");
    f = flowReduce(f, { type: "why-viewed" });
    expect(f.beat).toBe("patron-offer");
    f = flowReduce(f, { type: "choose-theme", theme: "forage" });
    expect(f.beat).toBe("living");
    expect(f.patronTheme).toBe("forage");
    expect(f.returnHook).toContain("守望");
  });
  it("hooks cap at 3 newest-first", () => {
    let f = createFlow("npc-1");
    f = flowReduce(f, { type: "dismiss-opening" });
    for (const n of ["一", "二", "三", "四"]) f = flowReduce(f, { type: "sim-event", line: n, hookable: true });
    expect(f.hooks).toEqual(["四", "三", "二"]);
    f = flowReduce(f, { type: "sim-event", line: "噪音", hookable: false });
    expect(f.hooks).toEqual(["四", "三", "二"]);
  });
  it("reducer is pure (input not mutated)", () => {
    const f = createFlow("npc-1");
    const before = JSON.stringify(f);
    flowReduce(f, { type: "dismiss-opening" });
    expect(JSON.stringify(f)).toBe(before);
  });
});
