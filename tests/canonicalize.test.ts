import { describe, it, expect } from "vitest";
import { canonicalize, hashCanonical, CANON_VERSION } from "../src/canon/canonicalize.js";

describe("canonicalize", () => {
  it("sorts object keys and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: [2, "x"] })).toBe('{"a":[2,"x"],"b":1}');
  });
  it("is insensitive to key insertion order", () => {
    const a = { x: 1, y: { q: 2, p: 3 } };
    const b = { y: { p: 3, q: 2 }, x: 1 };
    expect(hashCanonical(a)).toBe(hashCanonical(b));
  });
  it("rejects non-integer numbers", () => {
    expect(() => canonicalize({ v: 0.5 })).toThrow(/non-integer/);
    expect(() => canonicalize({ v: NaN })).toThrow(/non-integer/);
  });
  it("rejects undefined values", () => {
    expect(() => canonicalize({ v: undefined })).toThrow(/unsupported/);
  });
  it("handles null, booleans, nested arrays", () => {
    expect(canonicalize({ n: null, t: true, arr: [[1], []] })).toBe('{"arr":[[1],[]],"n":null,"t":true}');
  });
  it("produces a 64-char hex sha256", () => {
    expect(hashCanonical({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("exports the canon version", () => {
    expect(CANON_VERSION).toBe("int-canon-v1");
  });
});
