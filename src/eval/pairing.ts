import type { RosterEntry } from "../schema/core.js";
import type { SemanticEvent } from "../schema/log.js";
import type { WorldState } from "../world/state.js";
import { extractLineage } from "../chronicle/extract.js";
import { drawInt } from "../rng/rng.js";

export interface BioCandidate {
  arm: string;
  seedRoot: string;
  lineageId: string;
  peakGeneration: number;
  text: string;
}

export interface EvalPair {
  pairId: string;
  left: BioCandidate;
  right: BioCandidate;
  leftIsEvolutionary: boolean;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Frozen candidate-lineage selection (docs/prereg-1c-draft.md §4, "素材生成"): the
 * deepest surviving lineage of the seed, plus two more drawn deterministically over
 * the remaining survivors. Fewer than 3 survivors: return all of them (no draw).
 *
 * "Surviving" and "deepest" both come straight from LineageChronicle (extractLineage)
 * so this stays consistent with how biographies themselves define extinction/depth.
 */
export function pickLineages(events: SemanticEvent[], finalState: WorldState, roster: RosterEntry[], seedRoot: string): string[] {
  const chronicles = roster
    .map((r) => extractLineage(events, finalState, roster, r.npcId))
    .filter((c) => !c.extinct)
    .sort((a, b) => compareIds(a.lineageId, b.lineageId));

  const survivorIds = chronicles.map((c) => c.lineageId);
  if (survivorIds.length < 3) return survivorIds;

  let deepest = chronicles[0]!;
  for (const c of chronicles.slice(1)) {
    if (c.peakGeneration > deepest.peakGeneration) deepest = c;
  }

  const remaining = survivorIds.filter((id) => id !== deepest.lineageId);
  const picks = [0, 1].map((k) => remaining[drawInt(seedRoot, remaining.length, "bio-pick", k)]!);

  const result: string[] = [];
  for (const id of [deepest.lineageId, ...picks]) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

function peakGenerationBand(peakGeneration: number): number {
  if (peakGeneration <= 15) return 0;
  if (peakGeneration <= 30) return 1;
  return 2;
}

function candidateKey(c: BioCandidate): string {
  return `${c.seedRoot}|${c.lineageId}`;
}

function byCandidateKey(a: BioCandidate, b: BioCandidate): number {
  return compareIds(candidateKey(a), candidateKey(b));
}

/** Rendered-length match within ±20% (whichever side is longer). Two zero-length
 * texts count as matching; one zero-length against a nonzero one never matches. */
function lengthMatches(a: string, b: string): boolean {
  const lo = Math.min(a.length, b.length);
  const hi = Math.max(a.length, b.length);
  if (lo === 0) return hi === 0;
  return (hi - lo) / lo <= 0.2;
}

/**
 * Frozen pairing (docs/prereg-1c-draft.md §4, "配对"): match Evolutionary and
 * Handcrafted candidates within the same peakGeneration band (1–15 / 16–30 / 31+),
 * requiring rendered char length within ±20%. When the position-aligned candidates
 * don't fit, the Handcrafted side is redrawn: scan forward through that band's
 * unused Handcrafted candidates, in deterministic (seedRoot, lineageId) UTF-16
 * order, for the first one that fits. Evolutionary candidates that end up with no
 * fitting partner in their band are dropped (no pair emitted for them).
 *
 * Left/right side assignment is the only randomized step: drawInt(seedRoot, 2,
 * "bio-side", pairId).
 */
export function buildPairs(evo: BioCandidate[], hand: BioCandidate[], seedRoot: string): EvalPair[] {
  const pairs: EvalPair[] = [];
  let pairIndex = 0;

  for (let band = 0; band < 3; band++) {
    const evoBand = evo.filter((c) => peakGenerationBand(c.peakGeneration) === band).sort(byCandidateKey);
    const handBand = hand.filter((c) => peakGenerationBand(c.peakGeneration) === band).sort(byCandidateKey);
    const usedHand = new Set<number>();

    for (const evoCand of evoBand) {
      let chosen = -1;
      for (let j = 0; j < handBand.length; j++) {
        if (usedHand.has(j)) continue;
        if (lengthMatches(evoCand.text, handBand[j]!.text)) {
          chosen = j;
          break;
        }
      }
      if (chosen === -1) continue;
      usedHand.add(chosen);
      const handCand = handBand[chosen]!;

      const pairId = `pair-${pairIndex}`;
      const leftIsEvolutionary = drawInt(seedRoot, 2, "bio-side", pairId) === 0;
      const left = leftIsEvolutionary ? evoCand : handCand;
      const right = leftIsEvolutionary ? handCand : evoCand;
      pairs.push({ pairId, left, right, leftIsEvolutionary });
      pairIndex++;
    }
  }

  return pairs;
}

/** Frozen blinding-violation grep list (docs/prereg-1c-draft.md §4, "盲化核查表").
 * Latin/ASCII terms match case-insensitively; non-ASCII (CJK) terms match exactly
 * (case has no meaning for them). Extra terms — e.g. the run's own seedRoots — can
 * be passed in and are checked the same way. */
const FORBIDDEN_TERMS: readonly string[] = [
  "tick",
  "拍",
  "random",
  "fixed",
  "handcrafted",
  "evolutionary",
  "noculture",
  "算力",
  "代币",
  "模型",
  "锦标赛",
  "LoRA",
  "世界进化",
];

function isAsciiOnly(s: string): boolean {
  return /^[\x00-\x7F]*$/.test(s);
}

export function blindingViolations(text: string, ...extra: string[]): string[] {
  const forbidden = [...FORBIDDEN_TERMS, ...extra];
  const lowerText = text.toLowerCase();
  const violations: string[] = [];
  for (const term of forbidden) {
    const hit = isAsciiOnly(term) ? lowerText.includes(term.toLowerCase()) : text.includes(term);
    if (hit) violations.push(term);
  }
  return violations;
}
