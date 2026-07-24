import type { LineageChronicle } from "./extract.js";

/** One member-event (birth/death/belief) selected for a biography, identified by the
 * same (kind, npcId, tick) triple the source LineageChronicle record carries — enough
 * for a renderer to look the full record back up without duplicating its fields here. */
export interface SampledEvent {
  kind: "birth" | "death" | "belief";
  tick: number;
  npcId: string;
}

const DEFAULT_BUDGET = 12;
const DEFAULT_BANDS = 4;

// Priority within a band, lower sorts first: death (with cause) > belief_formed > birth.
const PRIORITY: Record<SampledEvent["kind"], number> = { death: 0, belief: 1, birth: 2 };

interface Candidate extends SampledEvent {
  generation: number;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function candidateOrder(a: Candidate, b: Candidate): number {
  const pa = PRIORITY[a.kind];
  const pb = PRIORITY[b.kind];
  if (pa !== pb) return pa - pb;
  if (a.tick !== b.tick) return a.tick - b.tick;
  return compareIds(a.npcId, b.npcId);
}

/**
 * Frozen cross-generation stratified sampler (docs/prereg-1c-draft.md §4, "跨代分层采样"):
 * fixes the recorded chronological-truncation bias of the v1 renderer's plain
 * earliest-N-events cap, which structurally starves late generations in any lineage
 * with more than a handful of members.
 *
 * Rule (exact, do not approximate):
 *  1. Partition generations [0..peakGeneration] into `bands` equal-width bands; the
 *     LAST band absorbs any remainder (peakGeneration+1 need not divide evenly).
 *  2. `budget` total member-event slots, allocated `floor(budget/bands)` to each band
 *     up front (remainder of that division also goes to the last band).
 *  3. Within a band, candidates are ranked death > belief_formed > birth; ties break
 *     on earlier tick, then npcId (UTF-16, i.e. plain string `<`).
 *  4. A band that can't fill its allocation (too few candidates) rolls its unused
 *     budget forward to the NEXT band. If budget still remains unspent after the
 *     last band, the process wraps ONCE back to band 0 and continues rolling forward
 *     through the bands a second time (never more than one wrap).
 *
 * No randomness: the sampler is a deterministic function of the chronicle alone.
 */
export function stratifiedSelect(
  c: LineageChronicle,
  budget: number = DEFAULT_BUDGET,
  bands: number = DEFAULT_BANDS,
): SampledEvent[] {
  if (bands < 1) throw new Error(`stratifiedSelect: bands must be >= 1, got ${bands}`);
  if (budget < 0) throw new Error(`stratifiedSelect: budget must be >= 0, got ${budget}`);

  const genOf = new Map(c.members.map((m) => [m.npcId, m.generation] as const));

  const allCandidates: Candidate[] = [];
  for (const m of c.members) {
    if (m.generation > 0 && m.parents !== null) {
      allCandidates.push({ kind: "birth", tick: m.birthTick, npcId: m.npcId, generation: m.generation });
    }
    if (m.deathTick !== null) {
      allCandidates.push({ kind: "death", tick: m.deathTick, npcId: m.npcId, generation: m.generation });
    }
  }
  for (const b of c.beliefsFormed) {
    allCandidates.push({ kind: "belief", tick: b.tick, npcId: b.npcId, generation: genOf.get(b.npcId) ?? 0 });
  }

  const peakGeneration = c.peakGeneration;
  const totalGens = peakGeneration + 1;
  const width = Math.floor(totalGens / bands);

  const bandOf = (generation: number): number => {
    if (width === 0) return bands - 1; // fewer generations than bands: everything falls in the last band
    return Math.min(Math.floor(generation / width), bands - 1);
  };

  const candidatesByBand: Candidate[][] = Array.from({ length: bands }, () => []);
  for (const cand of allCandidates) candidatesByBand[bandOf(cand.generation)]!.push(cand);
  for (const list of candidatesByBand) list.sort(candidateOrder);

  const base = Math.floor(budget / bands);
  const budgetPerBand = new Array<number>(bands).fill(base);
  budgetPerBand[bands - 1]! += budget - base * bands; // remainder of budget/bands to the last band

  const consumed = new Array<number>(bands).fill(0);
  const selected: Candidate[] = [];
  let carry = 0;

  // First pass: every band gets its own fresh allocation plus whatever rolled forward.
  for (let i = 0; i < bands; i++) {
    const avail = candidatesByBand[i]!.length - consumed[i]!;
    const take = Math.min(avail, budgetPerBand[i]! + carry);
    for (let k = 0; k < take; k++) selected.push(candidatesByBand[i]![consumed[i]! + k]!);
    consumed[i]! += take;
    carry = budgetPerBand[i]! + carry - take;
  }

  // Wrap once, forwarding only leftover carry (no fresh allocation), if anything remains.
  if (carry > 0) {
    for (let i = 0; i < bands && carry > 0; i++) {
      const avail = candidatesByBand[i]!.length - consumed[i]!;
      const take = Math.min(avail, carry);
      for (let k = 0; k < take; k++) selected.push(candidatesByBand[i]![consumed[i]! + k]!);
      consumed[i]! += take;
      carry -= take;
    }
  }

  return selected.map(({ kind, tick, npcId }) => ({ kind, tick, npcId }));
}
