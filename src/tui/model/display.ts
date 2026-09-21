import type { ProviderSummary } from "../../cli/catalog/catalog.js";
import type { EffortDescriptor } from "../../cli/catalog/catalog.js";
import type { ModelSelection } from "../../types.js";

/**
 * btop-style viewport floor enforced by `MinSizeGate`. Below either
 * dimension the app shows a resize notice instead of a broken layout.
 */
export const MIN_TERMINAL_WIDTH = 180;
export const MIN_TERMINAL_HEIGHT = 47;

/**
 * Viewport check for `MinSizeGate`. Pure so it stays unit testable; the
 * live dimensions come from `useTerminalDimensions`, which follows pty
 * resizes (local, tmux, and SSH alike — all arrive as SIGWINCH on stdout,
 * no local-only APIs involved).
 */
export function isTerminalTooSmall(width: number, height: number): boolean {
  return width < MIN_TERMINAL_WIDTH || height < MIN_TERMINAL_HEIGHT;
}

/**
 * The `model` field on a thread's `modelSelection` is a provider-side slug
 * (`opencode/muse-spark-1.3-contributor-free`). The human-readable name lives
 * in the provider catalog (`server.getConfig`), so the composer footer and
 * timeline resolve it there and only fall back to prettifying the slug when
 * the catalog has not loaded yet.
 */
export function prettifyModelSlug(slug: string): string {
  const tail = slug.split("/").pop() ?? slug;
  const words = tail.split(/[-_]+/g).filter((word) => word.length > 0);
  if (words.length === 0) return slug;
  return words
    .map((word) =>
      /^[vV]?\d/.test(word) || /^x\d/i.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

export function displayModelName(
  providers: readonly ProviderSummary[] | null,
  selection: ModelSelection | undefined,
): string {
  if (selection === undefined) return "-";
  const model = providers
    ?.find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((candidate) => candidate.slug === selection.model);
  if (model !== undefined) return model.name;
  return prettifyModelSlug(selection.model);
}

/**
 * Whether a descriptor id is an effort knob (as opposed to display-only
 * selects like a context window). Defaults attach and resolve only on
 * these; anything else stays unset until explicitly picked.
 */
export function isEffortDescriptor(id: string): boolean {
  return /effort|reasoning|thinking/i.test(id);
}

/**
 * Enforced default for one effort descriptor: `medium` when offered,
 * else the middle choice (median-ish for ordered low→high lists), else
 * null. The footer and the pick flow resolve through this so the knob
 * never reads blank and sends carry a real value.
 */
export function defaultEffortChoice(descriptor: EffortDescriptor): string | null {
  if (descriptor.choices.some((choice) => choice.id === "medium")) return "medium";
  const middle = descriptor.choices[Math.floor((descriptor.choices.length - 1) / 2)];
  return middle?.id ?? null;
}

/**
 * The effort knob (e.g. `xhigh`) rides on `modelSelection.options`. Resolve
 * its display label through the model's select-type effort descriptors:
 * explicit choice first, then the catalog default (`currentValue`, then
 * the `isDefault` flag — some drivers never populate `currentValue`),
 * then the enforced default above. Switching models (or drafting a new
 * thread) often drops the previous option because its id doesn't exist on
 * the new model; the enforced default keeps the knob populated instead of
 * going blank. Boolean flags are never effort.
 */
export function displayEffort(
  providers: readonly ProviderSummary[] | null,
  selection: ModelSelection | undefined,
): string | null {
  if (selection === undefined) return null;
  const strings = (selection.options ?? []).filter(
    (option): option is { id: string; value: string } => typeof option.value === "string",
  );

  const model = providers
    ?.find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((candidate) => candidate.slug === selection.model);
  if (model !== undefined) {
    for (const effort of model.efforts) {
      const explicit = strings.find((option) => option.id === effort.id)?.value;
      if (explicit !== undefined) {
        const choice = effort.choices.find((candidate) => candidate.id === explicit);
        return choice?.label ?? explicit;
      }
      const fallback = effort.currentValue ??
        effort.choices.find((choice) => choice.isDefault === true)?.id ??
        (isEffortDescriptor(effort.id) ? defaultEffortChoice(effort) : null);
      if (fallback === null) continue;
      const choice = effort.choices.find((candidate) => candidate.id === fallback);
      return choice?.label ?? fallback;
    }
    return null;
  }

  if (strings.length === 0) return null;
  const preferred = strings.find((option) => /effort|reasoning|thinking/i.test(option.id)) ?? strings[0];
  return preferred === undefined ? null : preferred.value;
}
