export const RNG_SCHEME_VERSION = "fnv1a-mulberry32-v1";

/** 32-bit FNV-1a hash of a string. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Stateless draw in [0, n). Keyed entirely by (seedRoot, ...parts) — the same
 * key always yields the same value, so replay never needs RNG state.
 * Modulo bias is acceptable at game scale (documented, n << 2^32).
 */
export function drawInt(seedRoot: string, n: number, ...parts: (string | number)[]): number {
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`drawInt: bad n=${n}`);
  const key = `${seedRoot}|${parts.join("|")}`;
  return mulberry32(fnv1a32(key))() % n;
}
