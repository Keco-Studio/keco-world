import { describe, it, expect } from "vitest";
import { wilson, percentile } from "../src/bench/stats.js";

describe("wilson", () => {
  it("50/100 brackets 0.5 roughly ±0.10", () => {
    const { p, lo, hi } = wilson(50, 100);
    expect(p).toBe(0.5);
    expect(lo).toBeGreaterThan(0.40);
    expect(lo).toBeLessThan(0.45);
    expect(hi).toBeGreaterThan(0.55);
    expect(hi).toBeLessThan(0.60);
  });
  it("extremes stay within [0,1]", () => {
    expect(wilson(0, 20).lo).toBe(0);
    expect(wilson(20, 20).hi).toBe(1);
    expect(wilson(20, 20).lo).toBeGreaterThan(0.8);
  });
  it("n=0 is the vacuous interval", () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });
  it("larger n narrows the interval", () => {
    const small = wilson(55, 100);
    const large = wilson(550, 1000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });
  it("the preregistered gate example: 180/300 wins passes, 165/300 does not", () => {
    const pass = wilson(180, 300);   // p=0.60
    expect(pass.p).toBeGreaterThanOrEqual(0.55);
    expect(pass.lo).toBeGreaterThan(0.50);
    const fail = wilson(165, 300);   // p=0.55 but CI includes 0.50
    expect(fail.lo).toBeLessThanOrEqual(0.50);
  });
});

describe("percentile", () => {
  it("nearest-rank behaviour", () => {
    const xs = [5, 1, 3, 2, 4];
    expect(percentile(xs, 50)).toBe(3);
    expect(percentile(xs, 100)).toBe(5);
    expect(percentile(xs, 1)).toBe(1);
  });
  it("does not mutate input and handles empty", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });
});
