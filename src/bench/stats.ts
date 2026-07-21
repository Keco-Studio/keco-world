/** Wilson score interval for a binomial proportion. Stats module — floats allowed. */
export function wilson(wins: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 1 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

/** Nearest-rank percentile on a sorted copy; q in [0,100]. Empty input → NaN. */
export function percentile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((q / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}
