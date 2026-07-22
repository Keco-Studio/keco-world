import { defineConfig } from "vitest/config";
// testTimeout raised from the 5s default: degradation.test.ts runs multiple
// multi-thousand-tick simulations inside a single `it()` block (chunked +
// determinism-repeat), which legitimately takes longer than 5s.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 } });
