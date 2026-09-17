export interface PatchFile {
  path: string;
  filetype: string | undefined;
  patch: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

const FILETYPES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  cjs: "typescript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  zig: "zig",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  css: "css",
  html: "html",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
};

/** Grammar name for a path, matching the identifiers OpenTUI's tree-sitter client expects. */
export function detectFiletype(filePath: string): string | undefined {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension === undefined ? undefined : FILETYPES[extension];
}

function pathFromHeader(line: string): string | null {
  // `diff --git a/<path> b/<path>`; the b-side is authoritative for renames.
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
  if (match === null) return null;
  return match[2] ?? match[1] ?? null;
}

/**
 * Splits a multi-file git patch into per-file patches. Each file needs its own
 * `<diff>` so the renderer can pick the right grammar for highlighting.
 */
export function splitPatchByFile(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: { path: string; lines: string[] } | null = null;

  const flush = () => {
    if (current === null) return;
    const body = current.lines.join("\n");
    files.push({
      path: current.path,
      filetype: detectFiletype(current.path),
      patch: body,
      additions: current.lines.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length,
      deletions: current.lines.filter((line) => line.startsWith("-") && !line.startsWith("---")).length,
      binary: current.lines.some((line) => line.startsWith("Binary files ")),
    });
    current = null;
  };

  for (const line of patch.split("\n")) {
    const path = pathFromHeader(line);
    if (path !== null) {
      flush();
      current = { path, lines: [line] };
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  flush();
  return files;
}

export function shortPath(value: string, width: number): string {
  if (value.length <= width) return value;
  return `…${value.slice(value.length - width + 1)}`;
}

/**
 * Matches an activity row's (possibly shortened) path against a turn patch's
 * file list. Row paths come shortened (`src/tui/app.tsx`, sometimes
 * `tui/app.tsx`) while patch headers carry the full repo-relative path, so
 * this matches by suffix in either direction — the same rule the
 * checkpoint-stats matcher uses.
 */
export function findPatchFile(files: readonly PatchFile[], path: string): PatchFile | null {
  const norm = path.replace(/\\/g, "/").toLowerCase();
  if (norm.length === 0 || norm === "…") return null;
  for (const file of files) {
    const candidate = file.path.toLowerCase();
    if (candidate.length > 0 && (candidate.endsWith(norm) || norm.endsWith(candidate))) return file;
  }
  return null;
}
