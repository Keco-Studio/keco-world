import type { WorldManifest } from "../schema/core.js";
import { seasonAt } from "../world/state.js";
import type { LineageChronicle, LineageMember } from "./extract.js";

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
}

/**
 * Template-only markdown biography. Every sentence traces to a LineageChronicle
 * field (grounding); no seed strings, parameter values, tick integers, or raw
 * lineage/arm ids ever appear — only in-world names, season-year notation and events.
 */
export function renderBiography(c: LineageChronicle, manifest: WorldManifest): string {
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

  const selectedEvents = [...births, ...deaths].sort(eventOrder).slice(0, MAX_EVENT_SENTENCES);

  const selectedBeliefs: RawLine[] = c.beliefsFormed.slice(0, MAX_BELIEF_SENTENCES).map((b) => ({
    tick: b.tick,
    npcId: b.npcId,
    name: b.name,
    generation: genOf.get(b.npcId) ?? 0,
    kind: "belief",
    proposition: b.proposition,
  }));

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
    return `${seasonYear(line.tick, manifest)}，${subject}学会了：『${line.proposition}』`;
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
