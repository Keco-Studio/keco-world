// Boots the web shell: finds an opening moment via the Moment Director, drives the live
// in-browser kernel with a setInterval stepper, and renders it through Excalibur. All
// player-facing text lives in viewmodel.ts; this file only wires DOM <-> sim <-> render.
import { findOpening } from "../../src/director/director.js";
import { makeDemoManifest, makeDemoRoster } from "../../src/cli/demo.js";
import { createSim } from "./sim.js";
import { createEngine, initWorld, syncWorld, type CameraMode } from "./render.js";
import { eventLine } from "./viewmodel.js";

const SEED = "shell-1";

const manifest = makeDemoManifest();
const roster = makeDemoRoster(SEED);
const opening = findOpening(manifest, roster, SEED);

const sim = createSim(manifest, roster, SEED, opening);

const followedId: string = opening.moment.npcId;
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

const eventsEl = document.querySelector<HTMLUListElement>("#events");
let renderedEventCount = 0;

function flushEventFeed(): void {
  if (eventsEl === null) return;
  const nameMap = names();
  const fresh = sim.events.slice(renderedEventCount);
  renderedEventCount = sim.events.length;
  for (const ev of fresh) {
    const line = eventLine(ev, nameMap);
    if (line === null) continue;
    const li = document.createElement("li");
    li.textContent = `[第 ${ev.tick} 拍] ${line}`;
    eventsEl.appendChild(li);
  }
  // cap the feed so it doesn't grow unbounded during a long session
  while (eventsEl.childElementCount > 200) {
    eventsEl.removeChild(eventsEl.firstChild!);
  }
  eventsEl.scrollTop = eventsEl.scrollHeight;
}

function tick(): void {
  sim.step();
  syncWorld(engine, manifest, sim, followedId, cameraMode);
  flushEventFeed();
}

// initial paint of the opening moment before any stepping
syncWorld(engine, manifest, sim, followedId, cameraMode);
flushEventFeed();

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
