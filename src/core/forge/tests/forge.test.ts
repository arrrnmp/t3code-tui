import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectForge, listRequests, parseRemote } from "../forge.js";
import type { ForgeDetection } from "../forge.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

describe("parseRemote", () => {
  it("reads the scp-style form git uses for ssh remotes", () => {
    expect(parseRemote("git@github.com:owner/repo.git")).toEqual({ host: "github.com", slug: "owner/repo" });
    expect(parseRemote("github.com:owner/repo")).toEqual({ host: "github.com", slug: "owner/repo" });
  });

  it("reads https and ssh:// forms, port and all", () => {
    expect(parseRemote("https://github.com/owner/repo.git")).toEqual({ host: "github.com", slug: "owner/repo" });
    expect(parseRemote("ssh://git@git.example.com:2222/owner/repo")).toEqual({
      host: "git.example.com",
      slug: "owner/repo",
    });
  });

  it("keeps every segment of a nested GitLab path", () => {
    // GitLab subgroups are part of the project's identity; truncating to
    // the last two segments would address the wrong project.
    expect(parseRemote("https://gitlab.com/group/sub/deeper/repo.git")).toEqual({
      host: "gitlab.com",
      slug: "group/sub/deeper/repo",
    });
  });

  it("refuses anything that is not an owner/name pair", () => {
    expect(parseRemote("")).toBeNull();
    expect(parseRemote("   ")).toBeNull();
    expect(parseRemote("not a url")).toBeNull();
    expect(parseRemote("https://github.com/single")).toBeNull();
    expect(parseRemote("https://")).toBeNull();
  });

  it("tolerates trailing slashes and a missing .git", () => {
    expect(parseRemote("https://github.com/owner/repo/")).toEqual({ host: "github.com", slug: "owner/repo" });
  });
});

describe("detectForge", () => {
  it("says so plainly when the integration is switched off", async () => {
    const detection = await detectForge(process.cwd(), { enabled: false });
    expect(detection.kind).toBeNull();
    expect(detection.reason).toMatch(/turned off/i);
  });

  it("reports a folder with no origin remote rather than failing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "moxen-forge-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const detection = await detectForge(dir);
    expect(detection).toMatchObject({ kind: null, installed: false, authenticated: false });
    expect(detection.reason).toMatch(/no origin remote/i);
  });

  it("refuses a write when no forge CLI is usable, with the detection's reason", async () => {
    const unusable: ForgeDetection = {
      kind: null,
      remoteUrl: "https://example.invalid/owner/repo.git",
      host: "example.invalid",
      slug: "owner/repo",
      cli: null,
      installed: false,
      authenticated: false,
      reason: "gh is not installed.",
    };
    await expect(listRequests(process.cwd(), unusable)).rejects.toThrow("gh is not installed.");
  });

  it("refuses when a CLI is present but signed out", async () => {
    const signedOut: ForgeDetection = {
      kind: "github",
      remoteUrl: "https://github.com/owner/repo.git",
      host: "github.com",
      slug: "owner/repo",
      cli: "gh",
      installed: true,
      authenticated: false,
      reason: "gh is installed but not logged in. Run `gh auth login`.",
    };
    await expect(listRequests(process.cwd(), signedOut)).rejects.toThrow(/not logged in/);
  });
});
