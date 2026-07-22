import type { WorldManifest, RosterEntry, Belief, EffectTarget } from "../schema/core.js";
import { makeDemoManifest, makeDemoRoster } from "../cli/demo.js";

export const ARM_IDS = ["random", "fixed", "handcrafted", "evolutionary"] as const;
export type ArmId = (typeof ARM_IDS)[number];

export interface ArmSetup {
  manifest: WorldManifest;
  roster: RosterEntry[];
}

function rule(
  proposition: string,
  target: EffectTarget,
  modifier: number,
  condition: "winter" | "summer" | null,
  confidence: number
): Belief {
  return {
    proposition,
    effect: { target, modifier, condition },
    confidence,
    source: "designed",
    acquiredTick: 0,
    decayPer100: 0,
  };
}

export const HANDCRAFTED_ARCHETYPES: RosterEntry[] = [
  {
    npcId: "npc-1",
    name: "Rill",
    identity: {
      riskTolerance: 300,
      socialTrust: 500,
      explorationBias: 250,
      patience: 850,
      voiceStyle: "囤积者——过冬的浆果永远不嫌多",
    },
    policy: {
      utilityWeights: { forage: 850, consume: 700, shelter: 650, seekMate: 400, explore: 150, idle: 30 },
      thresholds: { hungerUrgent: 200 },
      deliberationEpsilon: 40,
    },
    beliefs: [rule("冬藏胜于冬狩", "w:forage", 200, "winter", 900)],
  },
  {
    npcId: "npc-2",
    name: "Ash",
    identity: {
      riskTolerance: 700,
      socialTrust: 400,
      explorationBias: 950,
      patience: 300,
      voiceStyle: "流浪者——脚下的路比身后的巢更真实",
    },
    policy: {
      utilityWeights: { forage: 550, consume: 750, shelter: 450, seekMate: 350, explore: 500, idle: 20 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 80,
    },
    beliefs: [rule("远方总有新的浆果丛", "w:explore", 150, null, 700)],
  },
  {
    npcId: "npc-3",
    name: "Fenna",
    identity: {
      riskTolerance: 150,
      socialTrust: 650,
      explorationBias: 100,
      patience: 800,
      voiceStyle: "守巢者——门外的世界与我无关",
    },
    policy: {
      utilityWeights: { forage: 500, consume: 800, shelter: 950, seekMate: 500, explore: 60, idle: 80 },
      thresholds: { hungerUrgent: 180 },
      deliberationEpsilon: 30,
    },
    beliefs: [rule("冬季闭户", "w:shelter", 250, "winter", 950)],
  },
  {
    npcId: "npc-4",
    name: "Bram",
    identity: {
      riskTolerance: 950,
      socialTrust: 500,
      explorationBias: 700,
      patience: 200,
      voiceStyle: "莽夫——怕这怕那还算活着吗",
    },
    policy: {
      utilityWeights: { forage: 750, consume: 800, shelter: 250, seekMate: 550, explore: 350, idle: 10 },
      thresholds: { hungerUrgent: 120 },
      deliberationEpsilon: 60,
    },
    beliefs: [],
  },
  {
    npcId: "npc-5",
    name: "Sorrel",
    identity: {
      riskTolerance: 250,
      socialTrust: 550,
      explorationBias: 300,
      patience: 700,
      voiceStyle: "未雨绸缪者——饿意是死亡的第一封信",
    },
    policy: {
      utilityWeights: { forage: 700, consume: 850, shelter: 700, seekMate: 450, explore: 120, idle: 40 },
      thresholds: { hungerUrgent: 320 },
      deliberationEpsilon: 30,
    },
    beliefs: [rule("宁可早食一刻", "t:hungerUrgent", 150, null, 800)],
  },
  {
    npcId: "npc-6",
    name: "Wren",
    identity: {
      riskTolerance: 500,
      socialTrust: 900,
      explorationBias: 400,
      patience: 550,
      voiceStyle: "交际花——独活不算活",
    },
    policy: {
      utilityWeights: { forage: 550, consume: 750, shelter: 600, seekMate: 900, explore: 200, idle: 50 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 70,
    },
    beliefs: [],
  },
  {
    npcId: "npc-7",
    name: "Tarn",
    identity: {
      riskTolerance: 600,
      socialTrust: 80,
      explorationBias: 650,
      patience: 600,
      voiceStyle: "独行者——同伴只会分走我的浆果",
    },
    policy: {
      utilityWeights: { forage: 700, consume: 800, shelter: 550, seekMate: 80, explore: 320, idle: 60 },
      thresholds: { hungerUrgent: 160 },
      deliberationEpsilon: 40,
    },
    beliefs: [rule("同伴分食我的浆果", "w:seekMate", -200, null, 850)],
  },
  {
    npcId: "npc-8",
    name: "Isla",
    identity: {
      riskTolerance: 500,
      socialTrust: 500,
      explorationBias: 450,
      patience: 500,
      voiceStyle: "犹豫者——每个选择都值得再想一想",
    },
    policy: {
      utilityWeights: { forage: 620, consume: 780, shelter: 660, seekMate: 500, explore: 210, idle: 55 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 150,
    },
    beliefs: [],
  },
  {
    npcId: "npc-9",
    name: "Corin",
    identity: {
      riskTolerance: 550,
      socialTrust: 450,
      explorationBias: 350,
      patience: 400,
      voiceStyle: "果断者——想第二遍的人已经饿死了",
    },
    policy: {
      utilityWeights: { forage: 800, consume: 850, shelter: 600, seekMate: 450, explore: 150, idle: 10 },
      thresholds: { hungerUrgent: 140 },
      deliberationEpsilon: 0,
    },
    beliefs: [],
  },
  {
    npcId: "npc-10",
    name: "Vesna",
    identity: {
      riskTolerance: 400,
      socialTrust: 600,
      explorationBias: 400,
      patience: 700,
      voiceStyle: "顺时者——夏天做夏天的事，冬天做冬天的事",
    },
    policy: {
      utilityWeights: { forage: 650, consume: 780, shelter: 680, seekMate: 500, explore: 180, idle: 40 },
      thresholds: { hungerUrgent: 160 },
      deliberationEpsilon: 50,
    },
    beliefs: [
      rule("夏采", "w:forage", 180, "summer", 850),
      rule("冬蛰", "w:shelter", 220, "winter", 850),
    ],
  },
  {
    npcId: "npc-11",
    name: "Odo",
    identity: {
      riskTolerance: 350,
      socialTrust: 550,
      explorationBias: 200,
      patience: 950,
      voiceStyle: "闲逸者——急什么，浆果又不会跑",
    },
    policy: {
      utilityWeights: { forage: 480, consume: 720, shelter: 640, seekMate: 420, explore: 90, idle: 320 },
      thresholds: { hungerUrgent: 130 },
      deliberationEpsilon: 90,
    },
    beliefs: [],
  },
  {
    npcId: "npc-12",
    name: "Merle",
    identity: {
      riskTolerance: 60,
      socialTrust: 500,
      explorationBias: 150,
      patience: 600,
      voiceStyle: "惧狼者——每片阴影里都蹲着一头狼",
    },
    policy: {
      utilityWeights: { forage: 520, consume: 760, shelter: 900, seekMate: 430, explore: 80, idle: 60 },
      thresholds: { hungerUrgent: 170 },
      deliberationEpsilon: 30,
    },
    beliefs: [rule("狼在暗处", "w:shelter", 200, null, 900)],
  },
  {
    npcId: "npc-13",
    name: "Sable",
    identity: {
      riskTolerance: 500,
      socialTrust: 450,
      explorationBias: 300,
      patience: 250,
      voiceStyle: "饕餮——吃到嘴里的才是自己的",
    },
    policy: {
      utilityWeights: { forage: 780, consume: 950, shelter: 500, seekMate: 400, explore: 140, idle: 20 },
      thresholds: { hungerUrgent: 420 },
      deliberationEpsilon: 50,
    },
    beliefs: [],
  },
  {
    npcId: "npc-14",
    name: "Quinn",
    identity: {
      riskTolerance: 400,
      socialTrust: 350,
      explorationBias: 350,
      patience: 950,
      voiceStyle: "苦修者——饥饿磨砺心志",
    },
    policy: {
      utilityWeights: { forage: 560, consume: 520, shelter: 700, seekMate: 250, explore: 200, idle: 150 },
      thresholds: { hungerUrgent: 60 },
      deliberationEpsilon: 20,
    },
    beliefs: [rule("饥饿磨砺心志", "t:hungerUrgent", -100, null, 700)],
  },
  {
    npcId: "npc-15",
    name: "Petra",
    identity: {
      riskTolerance: 450,
      socialTrust: 700,
      explorationBias: 300,
      patience: 650,
      voiceStyle: "持家者——多摘一颗是一颗",
    },
    policy: {
      utilityWeights: { forage: 880, consume: 750, shelter: 620, seekMate: 620, explore: 130, idle: 30 },
      thresholds: { hungerUrgent: 190 },
      deliberationEpsilon: 40,
    },
    beliefs: [rule("多摘一颗是一颗", "w:forage", 120, null, 750)],
  },
  {
    npcId: "npc-16",
    name: "Lorn",
    identity: {
      riskTolerance: 200,
      socialTrust: 300,
      explorationBias: 200,
      patience: 500,
      voiceStyle: "悲观者——好日子长不了",
    },
    policy: {
      utilityWeights: { forage: 640, consume: 820, shelter: 780, seekMate: 300, explore: 90, idle: 70 },
      thresholds: { hungerUrgent: 260 },
      deliberationEpsilon: 60,
    },
    beliefs: [
      rule("冬天要人命", "t:hungerUrgent", 200, "winter", 900),
      rule("趁好日子多囤", "w:forage", 150, "summer", 700),
    ],
  },
  {
    npcId: "npc-17",
    name: "Hazel",
    identity: {
      riskTolerance: 650,
      socialTrust: 750,
      explorationBias: 600,
      patience: 450,
      voiceStyle: "乐天派——夏日属于远方",
    },
    policy: {
      utilityWeights: { forage: 580, consume: 760, shelter: 480, seekMate: 640, explore: 300, idle: 60 },
      thresholds: { hungerUrgent: 130 },
      deliberationEpsilon: 100,
    },
    beliefs: [rule("夏日属于远方", "w:explore", 180, "summer", 750)],
  },
  {
    npcId: "npc-18",
    name: "Garen",
    identity: {
      riskTolerance: 500,
      socialTrust: 800,
      explorationBias: 250,
      patience: 700,
      voiceStyle: "家长——血脉必须延续",
    },
    policy: {
      utilityWeights: { forage: 760, consume: 780, shelter: 650, seekMate: 820, explore: 110, idle: 40 },
      thresholds: { hungerUrgent: 170 },
      deliberationEpsilon: 40,
    },
    beliefs: [rule("血脉必须延续", "w:seekMate", 150, null, 900)],
  },
  {
    npcId: "npc-19",
    name: "Nyx",
    identity: {
      riskTolerance: 800,
      socialTrust: 200,
      explorationBias: 850,
      patience: 350,
      voiceStyle: "夜影——人群是最危险的地方",
    },
    policy: {
      utilityWeights: { forage: 620, consume: 740, shelter: 380, seekMate: 180, explore: 420, idle: 15 },
      thresholds: { hungerUrgent: 140 },
      deliberationEpsilon: 70,
    },
    beliefs: [],
  },
  {
    npcId: "npc-20",
    name: "Ives",
    identity: {
      riskTolerance: 420,
      socialTrust: 420,
      explorationBias: 380,
      patience: 620,
      voiceStyle: "精算者——挨饿不划算",
    },
    policy: {
      utilityWeights: { forage: 740, consume: 840, shelter: 640, seekMate: 460, explore: 160, idle: 25 },
      thresholds: { hungerUrgent: 210 },
      deliberationEpsilon: 0,
    },
    beliefs: [rule("冬日热量入不敷出", "w:consume", 120, "winter", 800)],
  },
  {
    npcId: "npc-21",
    name: "Runa",
    identity: {
      riskTolerance: 250,
      socialTrust: 620,
      explorationBias: 120,
      patience: 880,
      voiceStyle: "守旧者——祖辈怎么过冬我就怎么过冬",
    },
    policy: {
      utilityWeights: { forage: 660, consume: 800, shelter: 720, seekMate: 520, explore: 70, idle: 90 },
      thresholds: { hungerUrgent: 180 },
      deliberationEpsilon: 30,
    },
    beliefs: [
      rule("祖辈冬居于洞", "w:shelter", 200, "winter", 950),
      rule("远行招灾", "w:explore", -200, null, 850),
      rule("按时而食", "t:hungerUrgent", 100, null, 700),
    ],
  },
  {
    npcId: "npc-22",
    name: "Col",
    identity: {
      riskTolerance: 550,
      socialTrust: 400,
      explorationBias: 550,
      patience: 400,
      voiceStyle: "拾荒者——世上没有捡不完的浆果",
    },
    policy: {
      utilityWeights: { forage: 950, consume: 700, shelter: 460, seekMate: 340, explore: 280, idle: 20 },
      thresholds: { hungerUrgent: 150 },
      deliberationEpsilon: 50,
    },
    beliefs: [],
  },
  {
    npcId: "npc-23",
    name: "Tamsin",
    identity: {
      riskTolerance: 600,
      socialTrust: 650,
      explorationBias: 700,
      patience: 300,
      voiceStyle: "舞者——停下来的日子不算数",
    },
    policy: {
      utilityWeights: { forage: 560, consume: 740, shelter: 520, seekMate: 680, explore: 380, idle: 30 },
      thresholds: { hungerUrgent: 140 },
      deliberationEpsilon: 130,
    },
    beliefs: [],
  },
  {
    npcId: "npc-24",
    name: "Ebba",
    identity: {
      riskTolerance: 300,
      socialTrust: 850,
      explorationBias: 180,
      patience: 900,
      voiceStyle: "祖母——冬前囤足，冬后再见",
    },
    policy: {
      utilityWeights: { forage: 600, consume: 790, shelter: 740, seekMate: 560, explore: 100, idle: 110 },
      thresholds: { hungerUrgent: 200 },
      deliberationEpsilon: 60,
    },
    beliefs: [rule("冬前囤足", "w:forage", 160, "winter", 800)],
  },
  {
    npcId: "npc-25",
    name: "Joss",
    identity: {
      riskTolerance: 900,
      socialTrust: 480,
      explorationBias: 750,
      patience: 150,
      voiceStyle: "赌徒——富贵险中求",
    },
    policy: {
      utilityWeights: { forage: 680, consume: 770, shelter: 300, seekMate: 520, explore: 400, idle: 10 },
      thresholds: { hungerUrgent: 110 },
      deliberationEpsilon: 150,
    },
    beliefs: [rule("富贵险中求", "w:explore", 150, null, 700)],
  },
];

export function makeArmSetup(arm: ArmId, seedRoot: string): ArmSetup {
  const baseManifest = makeDemoManifest();

  const cognitionByArm: Record<ArmId, typeof baseManifest.cognition> = {
    random: { decisionMode: "random", inheritanceMode: "clone", beliefDynamics: "off" },
    fixed: { decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" },
    handcrafted: { decisionMode: "utility", inheritanceMode: "clone", beliefDynamics: "off" },
    evolutionary: { decisionMode: "utility", inheritanceMode: "breed", beliefDynamics: "on" },
  };

  const manifest: WorldManifest = {
    ...baseManifest,
    cognition: cognitionByArm[arm],
  };

  let roster: RosterEntry[];

  if (arm === "handcrafted") {
    roster = JSON.parse(JSON.stringify(HANDCRAFTED_ARCHETYPES)) as RosterEntry[];
  } else if (arm === "evolutionary") {
    roster = makeDemoRoster(seedRoot);
  } else {
    // "random" or "fixed"
    roster = makeDemoRoster(seedRoot).map((entry) => ({
      ...entry,
      policy: {
        ...entry.policy,
        deliberationEpsilon: 0,
      },
    }));
  }

  return { manifest, roster };
}
