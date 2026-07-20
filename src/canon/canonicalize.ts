import { createHash } from "node:crypto";

export const CANON_VERSION = "int-canon-v1";

/** Deterministic canonical JSON: sorted keys, no whitespace, integers only. */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`non-integer number in canonical data: ${value}`);
      }
      return String(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(",")}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`unsupported type in canonical data: ${typeof value}`);
  }
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
