// world2 chronicle: building sentences. v1's chronicle/biography.ts is frozen
// (see docs/superpowers/plans/2026-07-26-world-v2.1.md Global Constraints) and
// has no notion of buildings, so this is a standalone module rather than an
// extension of it.
import type { BuildingKind } from "../schema/world2.js";

/**
 * Frozen sentence per building kind, rendered for a `building_built` event.
 * The monument line deliberately says the building cannot feed anyone: a
 * no-benefit building is exactly the kind of thing worth recording in a
 * biography — it signals a founder acting on something other than survival.
 */
export function renderBuildingLine(kind: BuildingKind, name: string): string {
  switch (kind) {
    case "shelter":
      return `${name}盖起了一座庇护所。`;
    case "granary":
      return `${name}为族人立起了粮仓。`;
    case "monument":
      return `${name}立起了一座石碑，它不能充饥。`;
  }
}
