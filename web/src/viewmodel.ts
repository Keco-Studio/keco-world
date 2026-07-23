// Pure, DOM-free, Excalibur-free view logic for the web shell. Every string here is
// player-facing Chinese; keep this file importable and testable from plain Node (see
// tests/web-viewmodel.test.ts).
import type { UtilityKey } from "../../src/schema/core.js";
import type { SemanticEvent } from "../../src/schema/log.js";
import type { OpeningMoment } from "../../src/director/director.js";
import type { DecideInfo } from "../../src/sim/engine.js";
import type { NpcState } from "../../src/world/state.js";

export const DAY_TICKS = 100;

export function fmtDays(ticks: number): string {
  return `${(ticks / DAY_TICKS).toFixed(1)} 天`;
}

/** §4.2 opening-moment register: "冬天还有 X 天，他的储备只够 Y 天". */
export function riskLine(moment: OpeningMoment, energyDrainPerTick: number): string {
  const reserveDays = fmtDays(moment.reserves / energyDrainPerTick);
  return `冬天还有 ${fmtDays(moment.ticksToWinter)}，他的储备只够 ${reserveDays}`;
}

/** §4.2 opening-moment register: "当前目标" line, grounded in the director's moment kind. */
export function goalLine(moment: OpeningMoment): string {
  return moment.kind === "winter-shortfall"
    ? "当前目标：赶在寒冬前，把过冬的储备补满"
    : "当前目标：先找到吃的，撑过眼下这一关";
}

const VERB_LABELS: Record<UtilityKey, string> = {
  forage: "采集",
  consume: "进食",
  shelter: "避护",
  seekMate: "亲近",
  explore: "探索",
  idle: "歇息",
};

export function verbLabel(key: string): string {
  return VERB_LABELS[key as UtilityKey] ?? key;
}

/** "它犹豫时，你的守望让它倾向了" + the verb it tilted toward. */
export function patronMark(theme: UtilityKey): string {
  return `它犹豫时，你的守望让它倾向了${verbLabel(theme)}`;
}

export interface WhyCard {
  title: string;
  need: string;
  personality: string[];
  experience: string[];
  candidates: { label: string; score: number; chosen: boolean }[];
  sourceLine: string;
}

const SOURCE_LINES: Record<DecideInfo["actionSource"], string> = {
  reflex: "求生本能接管了这一步",
  utility: "它权衡后选了最优",
  resolver: "它犹豫了——最终凭性情倾向了这个选择",
  random: "它凭一时兴起，随手一试",
};

type IdentityField = "riskTolerance" | "socialTrust" | "explorationBias" | "patience";

/** Frozen 8-entry mapping: high (>650) / low (<350) label per identity field. */
const PERSONALITY_TRAITS: Record<IdentityField, { high: string; low: string }> = {
  riskTolerance: { high: "胆大包天", low: "谨小慎微" },
  socialTrust: { high: "亲近同伴", low: "独来独往" },
  explorationBias: { high: "天性好奇", low: "安于现状" },
  patience: { high: "沉得住气", low: "急性子" },
};

const TRAIT_HIGH = 650;
const TRAIT_LOW = 350;

export function buildWhyCard(info: DecideInfo, npc: NpcState, season: "summer" | "winter"): WhyCard {
  const hungerUrgent = npc.policy.thresholds.hungerUrgent;
  const need =
    npc.energy < hungerUrgent
      ? `饥饿难耐，急需进食（能量 ${npc.energy} / 阈值 ${hungerUrgent}）`
      : `尚不饥饿（能量 ${npc.energy}）`;

  const fields: { key: IdentityField; value: number }[] = [
    { key: "riskTolerance", value: npc.identity.riskTolerance },
    { key: "socialTrust", value: npc.identity.socialTrust },
    { key: "explorationBias", value: npc.identity.explorationBias },
    { key: "patience", value: npc.identity.patience },
  ];
  const personality = fields
    .slice()
    .sort((a, b) => Math.abs(b.value - 500) - Math.abs(a.value - 500))
    .slice(0, 2)
    .map((f) => {
      if (f.value > TRAIT_HIGH) return PERSONALITY_TRAITS[f.key].high;
      if (f.value < TRAIT_LOW) return PERSONALITY_TRAITS[f.key].low;
      return null;
    })
    .filter((label): label is string => label !== null);

  const experience = npc.beliefs
    .filter((b) => b.effect.condition === null || b.effect.condition === season)
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
    .map((b) => `『${b.proposition}』`);

  const candidates = (info.candidates ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((c) => ({ label: verbLabel(c.key), score: c.score, chosen: c.key === info.chosenKey }));

  let sourceLine = SOURCE_LINES[info.actionSource];
  if (info.patronDecisive && info.chosenKey !== null) {
    sourceLine += patronMark(info.chosenKey);
  }

  return {
    title: `第 ${info.tick} 拍的抉择`,
    need,
    personality,
    experience,
    candidates,
    sourceLine,
  };
}

function seasonWord(season: string): string {
  return season === "winter" ? "冬天" : "夏天";
}

export function eventLine(ev: SemanticEvent, names: Map<string, string>): string | null {
  const who = ev.npcId === null ? "" : (names.get(ev.npcId) ?? ev.npcId);
  switch (ev.kind) {
    case "birth":
      return `${who} 出生了。`;
    case "death":
      return `${who} 去世了（${String(ev.data["cause"] ?? "未知")}）。`;
    case "season_change":
      return ev.data["season"] === "winter" ? "寒冬降临。" : `季节转为${seasonWord(String(ev.data["season"]))}。`;
    case "belief_formed":
      return `${who} 领悟到了新的道理：『${String(ev.data["proposition"] ?? "")}』`;
    case "patron_set":
      return ev.data["theme"] === null
        ? `${who} 不再受到你的守望关注。`
        : `你的守望开始眷顾 ${who}，引向${verbLabel(String(ev.data["theme"]))}。`;
    default:
      return null;
  }
}
