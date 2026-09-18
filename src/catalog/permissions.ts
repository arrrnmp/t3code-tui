import type { ProviderSummary } from "./catalog.js";
import type { RuntimeMode } from "../types.js";

export interface RuntimeModeChoice {
  mode: RuntimeMode;
  label: string;
  description: string;
}

/**
 * The four permission levels, worded the way the desktop and mobile clients
 * word them. Order is canonical (most supervised first) and independent of
 * whatever order a provider lists its own supported modes in.
 */
export const RUNTIME_MODE_CHOICES: readonly RuntimeModeChoice[] = [
  {
    mode: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    mode: "auto",
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    mode: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
];

/**
 * Which permission levels to offer for a provider: its supported modes when
 * it states a non-empty list, every known mode otherwise (absent field,
 * legacy server, or an empty list all read as "no restriction" — the same
 * `length > 0` gate the desktop composer uses).
 */
export function runtimeModeChoicesForSupportedModes(
  supported: readonly RuntimeMode[] | null | undefined,
): RuntimeModeChoice[] {
  if (!supported || supported.length === 0) return [...RUNTIME_MODE_CHOICES];
  return RUNTIME_MODE_CHOICES.filter((choice) => supported.includes(choice.mode));
}

/** The offerable permission levels for one provider instance. */
export function runtimeModeChoicesForProvider(provider: Pick<ProviderSummary, "supportedRuntimeModes">): RuntimeModeChoice[] {
  return runtimeModeChoicesForSupportedModes(provider.supportedRuntimeModes);
}

/**
 * Resolve what to display/pick given the thread's persisted mode: the mode
 * itself when still offered, else the provider's first supported mode.
 * Never mutates anything — callers only write back on an explicit pick,
 * mirroring the desktop's display-without-mutating fallback for threads
 * whose mode their provider no longer offers.
 */
export function compatibleRuntimeMode(
  current: RuntimeMode,
  choices: readonly { mode: RuntimeMode }[],
): RuntimeMode {
  return choices.some((choice) => choice.mode === current) ? current : (choices[0]?.mode ?? current);
}

/** Pretty label for a mode; unknown strings pass through untouched. */
export function displayRuntimeMode(mode: string): string {
  return RUNTIME_MODE_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode;
}
