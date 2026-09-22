import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scope collection to this repo's own tests.
    //
    // `upstream/` holds full clones of reference implementations we check
    // behavior against. They are gitignored, but vitest's default glob does not know that, so it
    // collected every test file in there as well as our own -- `bun run check` then failed
    // on upstream's suites and could never pass.
    //
    // An `include` glob rather than an `exclude` of `upstream/`: allow-listing our own sources
    // stays correct no matter what other checkouts appear beside them.
    include: ["src/**/*.test.ts"],
  },
});
