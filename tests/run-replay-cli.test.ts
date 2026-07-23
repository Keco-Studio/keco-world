import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAndPersist } from "../src/cli/run.js";
import { loadAndVerify } from "../src/cli/replay.js";

const scratchDirs: string[] = [];
function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

describe("run/replay CLI wiring", () => {
  it("persists a patronized run and verifies clean including strict", () => {
    const scratch = scratchDir("keco-cli-patron-");
    const directivesPath = join(scratch, "in-directives.json");
    writeFileSync(directivesPath, JSON.stringify([{ tick: 50, npcId: "npc-1", theme: "forage" }]));
    const outDir = join(scratch, "run");

    runAndPersist({ seedRoot: "cli-patron-t", ticks: 400, outDir, directivesPath });

    // run CLI always writes directives.json, in canonical sorted form.
    expect(existsSync(join(outDir, "directives.json"))).toBe(true);
    const written = JSON.parse(readFileSync(join(outDir, "directives.json"), "utf8"));
    expect(written).toEqual([{ tick: 50, npcId: "npc-1", theme: "forage" }]);

    const outcome = loadAndVerify(outDir, { strict: true });
    expect(outcome.chainOk).toBe(true);
    expect(outcome.replayReport.ok).toBe(true);
    expect(outcome.strictReport?.ok).toBe(true);
    expect(outcome.ok).toBe(true);
  });

  it("run CLI writes an empty directives.json ([]) when no --directives given", () => {
    const scratch = scratchDir("keco-cli-nodir-");
    const outDir = join(scratch, "run");

    runAndPersist({ seedRoot: "cli-nodir-t", ticks: 200, outDir });

    const written = JSON.parse(readFileSync(join(outDir, "directives.json"), "utf8"));
    expect(written).toEqual([]);

    const outcome = loadAndVerify(outDir, { strict: true });
    expect(outcome.ok).toBe(true);
  });

  it("removing directives.json from a patronized run dir fails strict AND injected replay", () => {
    const scratch = scratchDir("keco-cli-removed-");
    const directivesPath = join(scratch, "in-directives.json");
    writeFileSync(directivesPath, JSON.stringify([{ tick: 50, npcId: "npc-1", theme: "forage" }]));
    const outDir = join(scratch, "run");

    runAndPersist({ seedRoot: "cli-removed-t", ticks: 400, outDir, directivesPath });
    unlinkSync(join(outDir, "directives.json"));

    const outcome = loadAndVerify(outDir, { strict: true });
    // patronThemes state diverges once directives are dropped: replay (injected) diverges too,
    // not just strict.
    expect(outcome.replayReport.ok).toBe(false);
    expect(outcome.strictReport?.ok).toBe(false);
    expect(outcome.ok).toBe(false);
  });

  it("verifies a legacy-layout unpatronized run dir (no directives.json ever written) clean, including --strict", () => {
    // Simulate a pre-existing run dir from before this feature: build one by hand without
    // ever calling the current run.ts (which always writes directives.json), to pin that
    // loadAndVerify's directives.json-absent path is truly optional, not merely unexercised.
    const scratch = scratchDir("keco-cli-legacy-");
    const outDir = join(scratch, "run");
    mkdirSync(outDir, { recursive: true });

    const withDirectives = scratchDir("keco-cli-legacy-src-");
    const srcOutDir = join(withDirectives, "run");
    runAndPersist({ seedRoot: "cli-legacy-t", ticks: 300, outDir: srcOutDir });
    for (const f of ["manifest.json", "roster.json", "meta.json", "actions.jsonl", "checkpoints.json", "events.jsonl"]) {
      writeFileSync(join(outDir, f), readFileSync(join(srcOutDir, f)));
    }
    // deliberately no directives.json in outDir

    expect(existsSync(join(outDir, "directives.json"))).toBe(false);
    const outcome = loadAndVerify(outDir, { strict: true });
    expect(outcome.chainOk).toBe(true);
    expect(outcome.replayReport.ok).toBe(true);
    expect(outcome.strictReport?.ok).toBe(true);
    expect(outcome.ok).toBe(true);
  });
});
