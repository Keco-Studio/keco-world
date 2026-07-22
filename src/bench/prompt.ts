import { drawInt } from "../rng/rng.js";
import type { ScoredCandidate } from "../mind/utility.js";
import type { TriggerPoint } from "./trigger.js";

export const PROMPT_VERSION = "bench-v1";

export interface RenderedPrompt {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  order: number[];
}

/** Deterministic Fisher-Yates keyed by trigger id — kills position bias without entropy. */
export function shuffleOrder(trigger: TriggerPoint): number[] {
  const order = trigger.candidates.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = drawInt(trigger.seedRoot, i + 1, "shuffle", trigger.id, i);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** Neutral action description — never includes scores or utility hints. */
export function describeAction(c: ScoredCandidate): string {
  const a = c.action;
  // Handle idle with seekMate before verb switch
  if (c.key === "seekMate" && a.verb === "idle") {
    return `stay close to your companion`;
  }
  switch (a.verb) {
    case "move":
      return `walk one step to (${a.to.x}, ${a.to.y}) — heading ${c.key === "shelter" ? "toward shelter" : c.key === "forage" ? "toward a berry bush" : c.key === "seekMate" ? "toward a companion" : "somewhere new"}`;
    case "take":
      return `pick a berry from the bush right here (${a.target})`;
    case "consume":
      return `eat one of the berries you are carrying`;
    case "flee":
      return `run away from the wolf`;
    case "idle":
      return `stay put and do nothing this turn`;
  }
}

export function renderPrompt(trigger: TriggerPoint, npcName: string): RenderedPrompt {
  const obs = trigger.observation;
  const order = shuffleOrder(trigger);
  const lines: string[] = [];
  lines.push(`It is ${obs.season}. Your health is ${obs.self.hp}/1000, energy ${obs.self.energy}/1000, and you carry ${obs.self.berries} berries.`);
  lines.push(obs.onShelter ? `You are inside a shelter.` : `You are outdoors${obs.nearestShelter ? `, ${obs.nearestShelter.dist} steps from the nearest shelter` : ""}.`);
  if (obs.visibleBushes.length > 0) {
    lines.push(`Berry bushes in sight: ${obs.visibleBushes.map((b) => `${b.id} (${b.dist} steps away, ${b.berries} berries)`).join("; ")}.`);
  } else {
    lines.push(`No berry bushes in sight.`);
  }
  lines.push(obs.wolf ? `A wolf is ${obs.wolf.dist} steps away.` : `No wolf in sight.`);
  lines.push(``);
  lines.push(`Your options:`);
  order.forEach((origIdx, displayIdx) => {
    lines.push(`${displayIdx + 1}. ${describeAction(trigger.candidates[origIdx]!)}`);
  });
  lines.push(``);
  lines.push(`Which option is best for your long-term survival? Answer with JSON: {"choice": <number>, "reason": "<one short sentence>"}.`);
  return {
    system: `You are ${npcName}, a villager surviving in a small world with seasons, food scarcity, and a predator. Winters are cold and drain health outdoors. Starving drains health. Think practically about survival. Respond with JSON only.`,
    user: lines.join("\n"),
    schema: {
      type: "object",
      properties: {
        choice: { type: "integer", minimum: 1, maximum: trigger.candidates.length },
        reason: { type: "string", maxLength: 200 },
      },
      required: ["choice", "reason"],
    },
    order,
  };
}
