// Boots the web shell: finds an opening moment via the Moment Director, drives the live
// in-browser kernel with a setInterval stepper, renders it through Excalibur, and layers the
// first-five-minutes flow (§4.2) on top as DOM overlays. All player-facing text lives in
// viewmodel.ts/ui.ts/flow.ts; this file only wires DOM <-> flow <-> sim <-> render together.
// The world never pauses for the overlays — ticking runs continuously in the background,
// exactly as the closing line (世界不会因你离线暂停) says.
import type { UtilityKey } from "../../src/schema/core.js";
import type { RunOptions } from "../../src/sim/engine.js";
import { findOpening } from "../../src/director/director.js";
import { makeDemoManifest, makeDemoRoster } from "../../src/cli/demo.js";
import { seasonAt } from "../../src/world/state.js";
import { extractLineage } from "../../src/chronicle/extract.js";
import { renderBiography } from "../../src/chronicle/biography.js";
import { createSim } from "./sim.js";
import { createEngine, initWorld, syncWorld, type CameraMode } from "./render.js";
import { eventLine, buildWhyCard, patronMark, riskLine, goalLine } from "./viewmodel.js";
import { createFlow, flowReduce } from "./flow.js";
import {
  showOpeningCard,
  showWhyButton,
  renderWhyCard,
  showPatronCard,
  renderEventFeed,
  renderHooks,
  showReturnHook,
  showBiographyButton,
  highlightBiographyButton,
  showBiography,
} from "./ui.js";

const SEED = "shell-1";

const manifest = makeDemoManifest();
const roster = makeDemoRoster(SEED);
const opening = findOpening(manifest, roster, SEED);

const sim = createSim(manifest, roster, SEED, opening);

const followedId: string = opening.moment.npcId;
const followedFounder = sim.state.npcs.find((n) => n.npcId === followedId)!;
const followedLineageId = followedFounder.lineageId;
const lineageFounderName = roster.find((r) => r.npcId === followedLineageId)?.name ?? followedFounder.name;

let flow = createFlow(followedId);
let cameraMode: CameraMode = "follow";
let ticksPerSecond = 2; // default 1x

const engine = createEngine();
initWorld(engine, manifest);
void engine.start();

function names(): Map<string, string> {
  const map = new Map<string, string>();
  for (const npc of sim.state.npcs) map.set(npc.npcId, npc.name);
  return map;
}

/** A theme chosen this tick is issued as a patron directive for the NEXT tick; consumed
 * (cleared) by the very next call to tick(). */
let pendingDirectives: RunOptions["patronDirectives"] | undefined;

function handleWhyClick(): void {
  const info = sim.lastDecisions.get(followedId);
  const npc = sim.state.npcs.find((n) => n.npcId === followedId);
  if (info === undefined || npc === undefined) return;
  const season = seasonAt(sim.state.tick, manifest);
  const card = buildWhyCard(info, npc, season);
  renderWhyCard(card, () => {
    flow = flowReduce(flow, { type: "why-viewed" });
    if (flow.beat === "patron-offer") {
      showPatronCard(handleChooseTheme);
    }
  });
}

function handleChooseTheme(theme: UtilityKey): void {
  flow = flowReduce(flow, { type: "choose-theme", theme });
  pendingDirectives = new Map([[sim.state.tick + 1, [{ npcId: followedId, theme }]]]);
  if (flow.returnHook !== null) showReturnHook(flow.returnHook);
  showBiographyButton(handleBiographyClick);
}

function handleBiographyClick(): void {
  const chronicle = extractLineage(sim.events, sim.state, roster, followedLineageId);
  const text = renderBiography(chronicle, manifest);
  showBiography(text);
}

let renderedEventCount = 0;

function processNewEvents(): void {
  const nameMap = names();
  const fresh = sim.events.slice(renderedEventCount);
  renderedEventCount = sim.events.length;

  const newLines: string[] = [];
  let hooksChanged = false;

  for (const ev of fresh) {
    // Followed-lineage filter: only births into this bloodline and beliefs formed by the
    // followed NPC itself are player-facing here — everything else in the world is noise
    // for a first-five-minutes session focused on one story.
    if (ev.kind === "birth" && ev.data["lineageId"] !== followedLineageId) continue;
    if (ev.kind === "belief_formed" && ev.npcId !== followedId) continue;

    const line = eventLine(ev, nameMap);
    if (line === null) continue;
    newLines.push(`[第 ${ev.tick} 拍] ${line}`);

    const hookable =
      (ev.kind === "season_change" && ev.data["season"] === "winter") ||
      (ev.kind === "birth" && ev.data["lineageId"] === followedLineageId) ||
      (ev.kind === "belief_formed" && ev.npcId === followedId);
    if (hookable) {
      flow = flowReduce(flow, { type: "sim-event", line, hookable: true });
      hooksChanged = true;
    }

    // §4.4: followed-NPC death — the cause chain is already in the feed line above (eventLine
    // includes the cause); no punishment framing, just an invitation to read the fuller record.
    if (ev.kind === "death" && ev.npcId === followedId) {
      highlightBiographyButton();
    }
  }

  // §4.1 标注: a patron-decisive tick gets its own feed line, independent of the SemanticEvent
  // log (this is DecideInfo audit data, not a world event).
  const decision = sim.lastDecisions.get(followedId);
  if (decision !== undefined && decision.patronDecisive && decision.chosenKey !== null) {
    const line = patronMark(decision.chosenKey);
    newLines.push(`[第 ${decision.tick} 拍] ${line}`);
    flow = flowReduce(flow, { type: "sim-event", line, hookable: true });
    hooksChanged = true;
  }

  if (newLines.length > 0) renderEventFeed(newLines);
  if (hooksChanged) renderHooks(flow.hooks);
}

function tick(): void {
  const directives = pendingDirectives;
  pendingDirectives = undefined;
  sim.step(directives);
  syncWorld(engine, manifest, sim, followedId, cameraMode);
  processNewEvents();
}

// initial paint of the opening moment before any stepping
syncWorld(engine, manifest, sim, followedId, cameraMode);

showOpeningCard(followedFounder.name, lineageFounderName, goalLine(opening.moment), riskLine(opening.moment, manifest.energyDrainPerTick), () => {
  flow = flowReduce(flow, { type: "dismiss-opening" });
  showWhyButton(handleWhyClick);
});

let timer: ReturnType<typeof setInterval> | null = null;

function setSpeed(tps: number): void {
  ticksPerSecond = tps;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (ticksPerSecond > 0) {
    timer = setInterval(tick, 1000 / ticksPerSecond);
  }
}

document.querySelectorAll<HTMLButtonElement>("#controls button[data-speed]").forEach((btn) => {
  btn.addEventListener("click", () => setSpeed(Number(btn.dataset["speed"])));
});

document.querySelectorAll<HTMLButtonElement>("#camera-toggle button[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    cameraMode = btn.dataset["mode"] === "overview" ? "overview" : "follow";
    syncWorld(engine, manifest, sim, followedId, cameraMode);
  });
});

setSpeed(ticksPerSecond);
