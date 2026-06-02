import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        // Entry points / side-effectful glue exercised by live smoke suites + CI,
        // not by unit tests:
        "src/index.ts",
        "src/server/http.ts",
        "src/createServer.ts",
        // Better Auth instance is a config object with side-effectful construction;
        // exercised by the live auth smoke, not unit tests.
        "src/auth/betterAuth.ts",
        // React Email templates (rendered, asserted via email smoke) and the
        // logger bootstrap:
        "src/emails/**",
        "src/observability/logger.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
