// Excalibur world view. This file is NOT unit-tested (verified visually in Task 6) — it
// only maps WorldState -> ex.Actor positions/graphics. All decision/formatting logic lives
// in viewmodel.ts / sim.ts.
import * as ex from "excalibur";
import type { WorldManifest } from "../../src/schema/core.js";
import { seasonAt } from "../../src/world/state.js";
import type { SimHandle } from "./sim.js";

export const TILE = 24;
const GRID_PIXEL = (n: number): number => n * TILE + TILE / 2;

/** 25-color palette, one hue per founder lineage. */
const LINEAGE_PALETTE: readonly string[] = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6",
  "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#fffac8", "#800000", "#aaffc3",
  "#808000", "#ffd8b1", "#000075", "#808080", "#ff9d9d", "#5ad3d1", "#c9a0ff", "#7fb069",
  "#f4a261",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorForLineage(lineageId: string): ex.Color {
  const idx = hashString(lineageId) % LINEAGE_PALETTE.length;
  return ex.Color.fromHex(LINEAGE_PALETTE[idx]!);
}

export function createEngine(): ex.Engine {
  return new ex.Engine({
    canvasElementId: "game",
    width: 960,
    height: 640,
    displayMode: ex.DisplayMode.FitScreen,
    backgroundColor: ex.Color.fromHex("#2d3b23"),
    suppressPlayButton: true,
    pointerScope: ex.PointerScope.Canvas,
  });
}

const actorsById = new Map<string, ex.Actor>();
let winterOverlay: ex.Actor | null = null;
let followOutline: ex.Actor | null = null;

// Graphic instance caches. ex.Circle/ex.Rectangle are Raster graphics — each `new` allocates
// a fresh canvas-backed GPU texture. Allocating them per entity per tick (as a naive syncWorld
// would) leaks textures until the WebGL context dies (observed live in Task 6 verification:
// context loss after ~900 ticks at 4×). Graphics are therefore created once per distinct look
// and shared; graphics.use() is only called when an actor's look actually changes.
const npcGraphicByLineage = new Map<string, ex.Circle>();
const bushGraphicByBucket = new Map<string, ex.Circle>();
let wolfGraphic: ex.Rectangle | null = null;
const lastLookById = new Map<string, string>();

function useGraphic(actor: ex.Actor, id: string, look: string, make: () => ex.Graphic): void {
  if (lastLookById.get(id) === look) return;
  actor.graphics.use(make());
  lastLookById.set(id, look);
}

function npcGraphic(lineageId: string): ex.Circle {
  let g = npcGraphicByLineage.get(lineageId);
  if (g === undefined) {
    g = new ex.Circle({ radius: TILE / 2 - 4, color: colorForLineage(lineageId) });
    npcGraphicByLineage.set(lineageId, g);
  }
  return g;
}

function bushGraphic(bucket: number): ex.Circle {
  const key = String(bucket);
  let g = bushGraphicByBucket.get(key);
  if (g === undefined) {
    const radius = bucket > 0 ? 3 + bucket : 3;
    const color = bucket > 0 ? ex.Color.fromHex("#2f9e44") : ex.Color.Gray;
    g = new ex.Circle({ radius, color });
    bushGraphicByBucket.set(key, g);
  }
  return g;
}

/** Draws the static parts of the world (shelters, winter overlay) once. Bushes/wolf/NPCs are
 * synced every tick in syncWorld since they move / change. */
export function initWorld(engine: ex.Engine, manifest: WorldManifest): void {
  for (const shelter of manifest.shelters) {
    const actor = new ex.Actor({
      pos: new ex.Vector(GRID_PIXEL(shelter.x), GRID_PIXEL(shelter.y)),
      width: TILE - 4,
      height: TILE - 4,
      z: 1,
    });
    actor.graphics.use(new ex.Rectangle({ width: TILE - 4, height: TILE - 4, color: ex.Color.fromHex("#7a5230") }));
    engine.add(actor);
  }

  winterOverlay = new ex.Actor({
    pos: new ex.Vector((manifest.gridWidth * TILE) / 2, (manifest.gridHeight * TILE) / 2),
    width: manifest.gridWidth * TILE,
    height: manifest.gridHeight * TILE,
    z: 100,
  });
  winterOverlay.graphics.use(
    new ex.Rectangle({ width: manifest.gridWidth * TILE, height: manifest.gridHeight * TILE, color: ex.Color.fromRGB(255, 255, 255, 0.18) }),
  );
  winterOverlay.graphics.isVisible = false;
  engine.add(winterOverlay);

  followOutline = new ex.Actor({ pos: ex.Vector.Zero, width: TILE, height: TILE, z: 6 });
  followOutline.graphics.use(
    new ex.Rectangle({ width: TILE, height: TILE, color: ex.Color.Transparent, strokeColor: ex.Color.Black, lineWidth: 2 }),
  );
  followOutline.graphics.isVisible = false;
  engine.add(followOutline);

  // NOTE deliberately no ex.Label here: Excalibur 0.32's ImageRendererV2 has a shader bug
  // ("Uniform u_matrix doesn't exist", observed live in Task 6 verification) where rasterized
  // text images eventually kill the WebGL context; ex.Flags.useLegacyImageRenderer() did not
  // avert it. The followed NPC's name is shown as a DOM badge instead (see main.ts), keeping
  // the canvas free of text rasterization entirely.
}

function ensureActor(engine: ex.Engine, id: string, factory: () => ex.Actor): ex.Actor {
  let actor = actorsById.get(id);
  if (actor === undefined) {
    actor = factory();
    actorsById.set(id, actor);
    engine.add(actor);
  }
  return actor;
}

export type CameraMode = "follow" | "overview";

/** Sync every ex.Actor's position/graphic from the live sim state. Called after every sim step. */
export function syncWorld(engine: ex.Engine, manifest: WorldManifest, handle: SimHandle, followedId: string | null, mode: CameraMode): void {
  const state = handle.state;
  const liveIds = new Set<string>();

  for (const bush of state.bushes) {
    liveIds.add(bush.id);
    const actor = ensureActor(engine, bush.id, () => new ex.Actor({ pos: ex.Vector.Zero, z: 2 }));
    actor.pos = new ex.Vector(GRID_PIXEL(bush.pos.x), GRID_PIXEL(bush.pos.y));
    // Quantized fullness bucket 0..7 → at most 8 shared textures for all bushes.
    const bucket = bush.berries > 0 && bush.capacity > 0 ? Math.max(1, Math.round((bush.berries / bush.capacity) * 7)) : 0;
    useGraphic(actor, bush.id, `bush-${bucket}`, () => bushGraphic(bucket));
  }

  {
    liveIds.add("wolf");
    const wolf = ensureActor(engine, "wolf", () => new ex.Actor({ pos: ex.Vector.Zero, z: 4 }));
    wolf.pos = new ex.Vector(GRID_PIXEL(state.wolf.pos.x), GRID_PIXEL(state.wolf.pos.y));
    useGraphic(wolf, "wolf", "wolf", () => {
      if (wolfGraphic === null) wolfGraphic = new ex.Rectangle({ width: TILE - 6, height: TILE - 6, color: ex.Color.fromHex("#7f1d1d") });
      return wolfGraphic;
    });
  }

  let followedPos: ex.Vector | null = null;
  for (const npc of state.npcs) {
    if (!npc.alive) continue;
    liveIds.add(npc.npcId);
    const actor = ensureActor(engine, npc.npcId, () => new ex.Actor({ pos: ex.Vector.Zero, z: 5 }));
    const pos = new ex.Vector(GRID_PIXEL(npc.pos.x), GRID_PIXEL(npc.pos.y));
    actor.pos = pos;
    useGraphic(actor, npc.npcId, `npc-${npc.lineageId}`, () => npcGraphic(npc.lineageId));
    if (npc.npcId === followedId) {
      followedPos = pos;
      if (followOutline !== null) {
        followOutline.pos = pos;
        followOutline.graphics.isVisible = true;
      }
    }
  }

  // Drop actors for entities that no longer exist (dead NPCs, depleted bushes never removed —
  // only NPCs actually disappear from state.npcs on death in this schema; bushes/wolf persist).
  for (const [id, actor] of actorsById) {
    if (!liveIds.has(id)) {
      engine.remove(actor);
      actorsById.delete(id);
      lastLookById.delete(id);
    }
  }

  // Followed NPC gone (died): hide the outline instead of leaving it stranded at the
  // last position.
  if (followedPos === null && followOutline !== null) {
    followOutline.graphics.isVisible = false;
  }

  const camera = engine.currentScene.camera;
  if (mode === "follow" && followedPos !== null) {
    camera.pos = followedPos;
    camera.zoom = 1.6;
  } else {
    camera.pos = new ex.Vector((manifest.gridWidth * TILE) / 2, (manifest.gridHeight * TILE) / 2);
    camera.zoom = 0.75;
  }

  if (winterOverlay !== null) {
    winterOverlay.graphics.isVisible = seasonAt(state.tick, manifest) === "winter";
  }
}
