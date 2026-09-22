/**
 * Grok permission option selection. The agent offers per-tool options with
 * `allow_once`/`allow_always`/`reject_*` kinds; T3 accepts for the session
 * via `allow_always` with an `allow_once` fallback (Grok 4.6 omits
 * `allow_always`), accepts once via `allow_once`, and declines via the
 * reject option (else the ACP `cancelled` outcome).
 */
export interface GrokPermissionOption {
  readonly optionId: string;
  readonly kind: string;
}

export type GrokPermissionDecision = "accept" | "acceptForSession";

function optionOfKind(
  options: ReadonlyArray<GrokPermissionOption>,
  kind: string,
): GrokPermissionOption | null {
  const found = options.find((option) => option.kind === kind);
  return found && found.optionId.trim() ? found : null;
}

/** Option id to answer with, or null when the agent offers nothing usable. */
export function selectGrokPermissionOptionId(
  options: ReadonlyArray<GrokPermissionOption>,
  decision: GrokPermissionDecision,
): string | null {
  if (decision === "acceptForSession") {
    return (
      optionOfKind(options, "allow_always")?.optionId ??
      optionOfKind(options, "allow_once")?.optionId ??
      null
    );
  }
  return (
    optionOfKind(options, "allow_once")?.optionId ??
    optionOfKind(options, "allow_always")?.optionId ??
    null
  );
}

export function selectGrokRejectOptionId(
  options: ReadonlyArray<GrokPermissionOption>,
): string | null {
  return (
    optionOfKind(options, "reject_once")?.optionId ??
    options.find((option) => option.kind.startsWith("reject") && option.optionId.trim())?.optionId ??
    null
  );
}

export function readPermissionOptions(value: unknown): GrokPermissionOption[] {
  if (!Array.isArray(value)) return [];
  const options: GrokPermissionOption[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record["optionId"] === "string" && typeof record["kind"] === "string") {
      options.push({ optionId: record["optionId"] as string, kind: record["kind"] as string });
    }
  }
  return options;
}
