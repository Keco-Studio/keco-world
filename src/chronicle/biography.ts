import type { WorldManifest } from "../schema/core.js";
import { seasonAt } from "../world/state.js";
import type { LineageChronicle, LineageMember } from "./extract.js";
import type { SampledEvent } from "./sample.js";
import { designedBeliefTick } from "./sample.js";

const MAX_EVENT_SENTENCES = 12;
const MAX_BELIEF_SENTENCES = 5;
const DRIFT_THRESHOLD = 80;

const DEATH_CAUSE_PHRASE: Record<string, string> = {
  starvation: "死于饥饿",
  cold: "死于严寒",
  wolf: "死于狼口",
  old_age: "寿终正寝",
};

const KEY_PHRASE: Record<string, string> = {
  forage: "采集",
  consume: "进食",
  shelter: "庇护",
  seekMate: "亲近同伴",
  explore: "远行",
  idle: "静处",
};

function deathPhrase(cause: string | null): string {
  if (cause !== null && cause in DEATH_CAUSE_PHRASE) return DEATH_CAUSE_PHRASE[cause]!;
  return "溘然离世";
}

function seasonYear(tick: number, manifest: WorldManifest): string {
  const year = Math.floor(tick / (2 * manifest.seasonLengthTicks)) + 1;
  const season = seasonAt(tick, manifest);
  return `第${year}年${season === "summer" ? "夏" : "冬"}`;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type LineKind = "birth" | "death" | "belief";

interface RawLine {
  tick: number;
  npcId: string;
  name: string;
  generation: number;
  kind: LineKind;
  parents?: [string, string];
  cause?: string | null;
  proposition?: string;
  /** belief lines only: true for the founder's roster-designed beliefs (no real
   * formation tick — `tick` here is a synthetic sentinel from designedBeliefTick),
   * false/absent for beliefs formed in play via belief_formed events. Selects which
   * of the two belief sentence templates renderLine uses. */
  designed?: boolean;
}

/**
 * Template-only markdown biography. Every sentence traces to a LineageChronicle
 * field (grounding); no seed strings, parameter values, tick integers, or raw
 * lineage/arm ids ever appear — only in-world names, season-year notation and events.
 *
 * `selection` (optional): when given (typically the output of `stratifiedSelect`),
 * the rendered member-event and belief sentences are EXACTLY the selected events —
 * same sentence templates, same section structure, chronological order within
 * sections — instead of the v1 earliest-N cap below. Omitted, the output uses the
 * same v1 selection logic as before (this branch is untouched by the selection
 * feature) — EXCEPT the belief sentence template, which changed for both paths (see
 * renderLine's belief branch): formed beliefs now read "{name}信奉：『…』，时在<season-year>。"
 * instead of the old "<season-year>，{name}学会了：『…』" — a deliberate, v1-visible
 * change (docs/prereg-1c-draft.md follow-up: de-blind belief-sentence leak). Only the
 * v2/selection path additionally surfaces the founder's designed beliefs.
 *
 * BLINDING SCOPING (2nd de-blind fix, docs/prereg-1c-draft.md §4 盲化核查表 信念句对称性):
 * a re-review found that even after unifying the VERB (信奉 for both), the v2/selection
 * path still had a categorical tell — formed beliefs carried a "，时在<season-year>。"
 * timestamp and designed beliefs didn't ("生来信奉" vs "信奉...时在"), so any belief
 * clause in a judge-packet biography still identified the arm with certainty (only
 * Evolutionary ever has a formed/timestamped belief; only Handcrafted-with-designed-
 * beliefs ever has a no-timestamp one). Fixed by scoping the blinding requirement to
 * exactly where it's load-bearing: the v2/selection path (the only one `evalpack.ts`
 * ever calls) now renders EVERY belief line — formed or designed — with ONE uniform,
 * timestamp-free template: "{name}信奉：『{proposition}』。". The v1 (no-selection) path
 * is a product-facing/demo renderer, not judge-packet material, so it deliberately
 * keeps the richer rendering (designed beliefs never even reach it) — blinding
 * constraints bind the eval instrument, not the product.
 */
export function renderBiography(c: LineageChronicle, manifest: WorldManifest, selection?: SampledEvent[]): string {
  const nameOf = new Map(c.members.map((m) => [m.npcId, m.name] as const));
  const genOf = new Map(c.members.map((m) => [m.npcId, m.generation] as const));
  const parentName = (id: string): string => nameOf.get(id) ?? "族外的伴侣";

  const births: RawLine[] = c.members
    .filter((m): m is LineageMember & { parents: [string, string] } => m.generation > 0 && m.parents !== null)
    .map((m) => ({ tick: m.birthTick, npcId: m.npcId, name: m.name, generation: m.generation, kind: "birth", parents: m.parents }));

  const deaths: RawLine[] = c.members
    .filter((m) => m.deathTick !== null)
    .map((m) => ({ tick: m.deathTick!, npcId: m.npcId, name: m.name, generation: m.generation, kind: "death", cause: m.deathCause }));

  const eventOrder = (a: RawLine, b: RawLine): number =>
    a.tick !== b.tick ? a.tick - b.tick : compareIds(a.npcId, b.npcId);

  const formedBeliefLines: RawLine[] = c.beliefsFormed.map((b) => ({
    tick: b.tick,
    npcId: b.npcId,
    name: b.name,
    generation: genOf.get(b.npcId) ?? 0,
    kind: "belief",
    proposition: b.proposition,
    designed: false,
  }));

  // Founder's designed beliefs (v2/selection path only — see LineageChronicle's
  // designedBeliefs doc comment for why this never surfaces for descendants, and
  // sample.ts's designedBeliefTick doc comment for the synthetic-tick scheme this
  // reconstructs to match a stratifiedSelect selection back to its proposition text).
  const founderName = nameOf.get(c.lineageId) ?? c.founderName;
  const designedBeliefLines: RawLine[] = c.designedBeliefs.map((b, i) => ({
    tick: designedBeliefTick(i, c.designedBeliefs.length),
    npcId: c.lineageId,
    name: founderName,
    generation: 0,
    kind: "belief",
    proposition: b.proposition,
    designed: true,
  }));

  let selectedEvents: RawLine[];
  let selectedBeliefs: RawLine[];
  if (selection !== undefined) {
    const key = (kind: LineKind, npcId: string, tick: number): string => `${kind}|${npcId}|${tick}`;
    const wanted = new Set(selection.map((s) => key(s.kind, s.npcId, s.tick)));
    const allBeliefLines = [...formedBeliefLines, ...designedBeliefLines];
    selectedEvents = [...births, ...deaths].filter((e) => wanted.has(key(e.kind, e.npcId, e.tick))).sort(eventOrder);
    selectedBeliefs = allBeliefLines.filter((b) => wanted.has(key(b.kind, b.npcId, b.tick))).sort(eventOrder);
  } else {
    // v1 path: unchanged selection logic (earliest-N cap, formed beliefs only —
    // designed beliefs are a v2/selection-only feature, see module doc above).
    selectedEvents = [...births, ...deaths].sort(eventOrder).slice(0, MAX_EVENT_SENTENCES);
    selectedBeliefs = formedBeliefLines.slice(0, MAX_BELIEF_SENTENCES);
  }

  const generations = new Set<number>();
  for (const e of selectedEvents) generations.add(e.generation);
  for (const b of selectedBeliefs) generations.add(b.generation);
  const sortedGenerations = [...generations].sort((a, b) => a - b);

  // Final printed order: generation-major (ascending), tick-minor within each generation.
  const byGeneration = new Map<number, RawLine[]>();
  const printOrder: RawLine[] = [];
  for (const g of sortedGenerations) {
    const lines = [...selectedEvents.filter((e) => e.generation === g), ...selectedBeliefs.filter((b) => b.generation === g)].sort(eventOrder);
    byGeneration.set(g, lines);
    printOrder.push(...lines);
  }

  // Namesake disambiguation: the in-world name pool is small and gets reused across
  // generations, so unrelated individuals can share a name (e.g. two different "Odo"s).
  // Mark the first sentence of any npcId whose name was already claimed by a different
  // npcId earlier in the printed order — grounded in the npcId collision, not invented.
  const nameOwner = new Map<string, string>();
  const seenNpc = new Set<string>();
  const disambiguateLine = new Set<RawLine>();
  for (const line of printOrder) {
    if (seenNpc.has(line.npcId)) continue;
    seenNpc.add(line.npcId);
    const owner = nameOwner.get(line.name);
    if (owner === undefined) {
      nameOwner.set(line.name, line.npcId);
    } else if (owner !== line.npcId) {
      disambiguateLine.add(line);
    }
  }
  const subjectOf = (line: RawLine): string => (disambiguateLine.has(line) ? `另一位${line.name}` : line.name);

  function renderLine(line: RawLine): string {
    const subject = subjectOf(line);
    if (line.kind === "birth") {
      const [parentA, parentB] = line.parents!;
      return `${subject}诞生于${seasonYear(line.tick, manifest)}，父母是${parentName(parentA)}与${parentName(parentB)}。`;
    }
    if (line.kind === "death") {
      return `${subject}${deathPhrase(line.cause ?? null)}，时在${seasonYear(line.tick, manifest)}。`;
    }
    // belief: selection mode (evalpack/judge-packet path) uses ONE uniform,
    // timestamp-free template for every belief regardless of formed-vs-designed —
    // see this function's BLINDING SCOPING doc comment above for why. The v1 path
    // (no `selection`, never sees designed beliefs) keeps the richer two-template
    // rendering: formed beliefs close on "，时在<season-year>。" like the death
    // template above; a designed belief (unreachable here in v1, kept for the
    // (currently unused-in-v1) `designed` flag's sake) would use "生来信奉".
    if (selection !== undefined) {
      return `${subject}信奉：『${line.proposition}』。`;
    }
    if (line.designed === true) {
      return `${subject}生来信奉：『${line.proposition}』。`;
    }
    return `${subject}信奉：『${line.proposition}』，时在${seasonYear(line.tick, manifest)}。`;
  }

  const genLabel = (g: number): string => (g === 0 ? "始祖" : `第${g}代`);
  const sections = sortedGenerations.map((g) => `## ${genLabel(g)}\n\n${byGeneration.get(g)!.map(renderLine).join(" ")}`);

  const lifeStatus = c.extinct ? "如今这一脉已经断绝。" : "如今这一脉仍在延续。";
  const opening =
    c.peakGeneration > 0
      ? `${c.founderName}是这一脉的始祖，其血脉历经${c.peakGeneration}代的繁衍。${lifeStatus}`
      : `${c.founderName}是这一脉的始祖，未留下子嗣。${lifeStatus}`;

  let closing: string;
  if (c.extinct) {
    closing = `${c.founderName}的这一脉最终在世间断绝，未留下存续的血脉。`;
  } else {
    const drifted = c.weightDrift.filter((d) => Math.abs(d.latest - d.founder) >= DRIFT_THRESHOLD);
    if (drifted.length === 0) {
      closing = `历经数代，这一脉的秉性与始祖${c.founderName}相比并无显著改变。`;
    } else {
      const phrases = drifted.map((d) => {
        const phrase = KEY_PHRASE[d.key] ?? d.key;
        return d.latest > d.founder ? `更热衷于${phrase}` : `更疏于${phrase}`;
      });
      closing = `历经数代演变，这一脉比先祖${phrases.join("，")}。`;
    }
  }

  const parts: string[] = [`# ${c.founderName}一脉纪事`, "", opening, ""];
  for (const section of sections) parts.push(section, "");
  parts.push("## 结语", "", closing);

  return parts.join("\n").trim() + "\n";
}
