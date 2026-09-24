/**
 * Resolve a folder to the workspace a project is keyed by: the Git root in
 * `repo` mode, the folder itself otherwise, canonicalized either way.
 * Moved from `cli/infra/`: project resolution is a domain operation every
 * client needs, not CLI plumbing. Path equality lives in
 * `./projects.ts` `workspaceRootsEqual`.
 */
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import { CliError } from "../errors.js";
import { runProcess } from "../infra/process.js";
import type { WorkspaceMode, WorkspaceResolution } from "../types.js";

async function gitOutput(cwd: string, args: readonly string[]): Promise<string | null> {
  const result = await runProcess("git", args, { cwd, allowFailure: true, timeoutMs: 10_000 }).catch(
    () => null,
  );
  if (!result || result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

export async function resolveWorkspace(
  inputPath: string,
  mode: WorkspaceMode,
): Promise<WorkspaceResolution> {
  const absoluteInput = path.resolve(inputPath);
  const inputStat = await stat(absoluteInput).catch((cause) => {
    throw new CliError("WORKSPACE_NOT_FOUND", `Workspace does not exist: ${absoluteInput}`, { cause });
  });
  if (!inputStat.isDirectory()) {
    throw new CliError("WORKSPACE_NOT_DIRECTORY", `Workspace is not a directory: ${absoluteInput}`);
  }

  const canonicalInput = await realpath(absoluteInput);
  const repoRoot = await gitOutput(canonicalInput, ["rev-parse", "--show-toplevel"]);
  const selected = mode === "repo" && repoRoot ? path.resolve(repoRoot) : canonicalInput;
  const workspaceRoot = await realpath(selected);
  const branch = repoRoot
    ? await gitOutput(workspaceRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"])
    : null;

  return {
    inputPath: canonicalInput,
    workspaceRoot,
    mode,
    isGitRepository: repoRoot !== null,
    branch,
  };
}
