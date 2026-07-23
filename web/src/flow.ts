// Pure, DOM-free state machine driving the first-five-minutes journey (§4.2). Beats are
// interaction-gated, not wall-clock-gated: the player's own actions (dismiss/why/theme)
// advance the beat. Never mutates its input — main.ts/ui.ts own all side effects.
import type { UtilityKey } from "../../src/schema/core.js";
import { verbLabel } from "./viewmodel.js";

export type Beat = "opening" | "watching" | "patron-offer" | "living";

export interface FlowState {
  beat: Beat;
  whyViewed: boolean;
  patronTheme: UtilityKey | null;
  followedId: string;
  /** 接下来值得看 lines, max 3, newest first. */
  hooks: string[];
  /** Set once when beat reaches "living" and a hook exists. */
  returnHook: string | null;
}

export function createFlow(followedId: string): FlowState {
  return {
    beat: "opening",
    whyViewed: false,
    patronTheme: null,
    followedId,
    hooks: [],
    returnHook: null,
  };
}

export type FlowEvent =
  | { type: "dismiss-opening" }
  | { type: "why-viewed" }
  | { type: "choose-theme"; theme: UtilityKey }
  | { type: "sim-event"; line: string; hookable: boolean };

const HOOKS_CAP = 3;

/** `第一场寒潮之后，${verbLabel(theme)}的守望会接受检验` — the fixed return-hook template. */
function returnHookLine(theme: UtilityKey): string {
  return `第一场寒潮之后，${verbLabel(theme)}的守望会接受检验`;
}

export function flowReduce(f: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case "dismiss-opening": {
      if (f.beat !== "opening") return f;
      return { ...f, beat: "watching" };
    }
    case "why-viewed": {
      if (f.beat !== "watching") return f;
      return { ...f, beat: "patron-offer", whyViewed: true };
    }
    case "choose-theme": {
      if (f.beat !== "patron-offer") return f;
      return {
        ...f,
        beat: "living",
        patronTheme: e.theme,
        returnHook: returnHookLine(e.theme),
      };
    }
    case "sim-event": {
      if (!e.hookable) return f;
      const hooks = [e.line, ...f.hooks].slice(0, HOOKS_CAP);
      return { ...f, hooks };
    }
    default:
      return f;
  }
}
