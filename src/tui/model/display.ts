import type { ProviderSummary } from "../../catalog/catalog.js";
import type { ModelSelection } from "../../types.js";

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
 * The effort knob (e.g. `xhigh`) rides on `modelSelection.options`. Resolve
 * its display label through the model's select-type effort descriptors,
 * falling back to that descriptor's default when the selection carries no
 * explicit choice — switching models (or drafting a new thread) often drops
 * the previous option because its id doesn't exist on the new model, and the
 * effort knob should show that model's default instead of going blank. The
 * default itself falls back from `currentValue` to the choice flagged
 * `isDefault` — some drivers (Claude) never populate `currentValue` at all,
 * only the per-choice flag. Otherwise show the raw selected value. Boolean
 * flags are never effort.
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
      const fallback = effort.currentValue ?? effort.choices.find((choice) => choice.isDefault === true)?.id ?? null;
      const pickedValue = explicit ?? fallback;
      if (pickedValue === null) continue;
      const choice = effort.choices.find((candidate) => candidate.id === pickedValue);
      return choice?.label ?? pickedValue;
    }
    return null;
  }

  if (strings.length === 0) return null;
  const preferred = strings.find((option) => /effort|reasoning|thinking/i.test(option.id)) ?? strings[0];
  return preferred === undefined ? null : preferred.value;
}
