import type { SemanticEvent } from "../schema/log.js";

export function narrate(event: SemanticEvent, names: Map<string, string>): string {
  const who = event.npcId === null ? "" : (names.get(event.npcId) ?? event.npcId);
  switch (event.kind) {
    case "death":
      return `[tick ${event.tick}] ${who} died (${event.data["cause"]}).`;
    case "wolf_attack":
      return `[tick ${event.tick}] The wolf attacked ${who} (-${event.data["damage"]} hp).`;
    case "starving":
      return `[tick ${event.tick}] ${who} is starving.`;
    case "season_change":
      return `[tick ${event.tick}] The season turned to ${event.data["season"]}.`;
    case "birth":
      return `[tick ${event.tick}] ${who} was born (gen ${event.data["generation"]}).`;
    case "belief_formed":
      return `[tick ${event.tick}] ${who} learned something (${event.data["target"]}).`;
  }
}
