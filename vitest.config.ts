import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scope collection to this repo's own tests.
    //
    // `upstream/` is a full clone of T3 Code kept as a reference for its orchestration API and
    // runtime contracts. It is gitignored, but vitest's default glob does not know that, so it
    // collected all ~3,466 test files in there as well as our own -- `bun run check` then failed
    // on upstream's suites and could never pass.
    //
    // An `include` glob rather than an `exclude` of `upstream/`: allow-listing our own sources
    // stays correct no matter what other checkouts appear beside them.
    include: ["src/**/*.test.ts"],
  },
});
