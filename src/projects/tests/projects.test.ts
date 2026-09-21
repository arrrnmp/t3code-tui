import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureStoredProject,
  listStoredProjects,
  resolveStoredProject,
  workspaceRootsEqual,
} from "../projects.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((run) => run()));
});

async function tmpRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "t3code-projects-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

describe("workspaceRootsEqual", () => {
  it("compares normalized roots", () => {
    expect(workspaceRootsEqual("/repo", "/repo/")).toBe(true);
    expect(workspaceRootsEqual("/repo", "/other")).toBe(false);
  });
});

describe("projects registry", () => {
  it("starts empty and ensures idempotently", async () => {
    const root = await tmpRoot();
    expect(await listStoredProjects(root)).toEqual([]);
    expect(await resolveStoredProject(root, "/repo")).toBeNull();

    const first = await ensureStoredProject(root, { workspaceRoot: "/repo/" });
    expect(first.created).toBe(true);
    expect(first.project.title).toBe("repo");
    expect(first.project.workspaceRoot).toBe(path.resolve("/repo"));
    expect(first.project.defaultModelSelection).toBeNull();
    expect(first.command?.type).toBe("project.create");

    const second = await ensureStoredProject(root, { workspaceRoot: "/repo" });
    expect(second.created).toBe(false);
    expect(second.project.id).toBe(first.project.id);
    expect(second.command).toBeNull();

    expect((await listStoredProjects(root)).length).toBe(1);
  });

  it("enforces the existing policy", async () => {
    const root = await tmpRoot();
    await expect(ensureStoredProject(root, { workspaceRoot: "/repo", policy: "existing" })).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });
});
