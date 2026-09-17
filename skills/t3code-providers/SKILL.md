---
name: t3code-providers
description: List T3 provider instances, models, and effort options. Use when the task needs valid --provider, --model, or --thinking-effort values instead of guessing them.
---

# Pick valid provider, model, and effort values

Use `t3code` for all commands. Do not guess provider or model ids. An unknown id fails with `PROVIDER_NOT_FOUND` or `MODEL_NOT_FOUND`.

```bash
t3code --json providers list
t3code --json models list --provider <instance-id>
t3code --json efforts list --provider <instance-id> --model <slug>
```

All three commands accept `--refresh`. This probes providers for fresh status first, and is slower. Without it, the CLI returns cached snapshots.

Reading the output:

- Offer only providers with `enabled: true`. A disabled provider can still list models, but selecting it fails.
- Skip models with `isHidden: true`. This means the user hid that model from T3's own picker (`providerModelPreferences`). It is a user preference, not an entitlement check — a hidden model can still be dispatched if you ask for it by slug, but do not offer it unprompted.
- Not every effort descriptor is a reasoning effort. Only the descriptor with `id: "effort"` gives valid `--thinking-effort` values. A `contextWindow` descriptor has no handover flag. `fastMode` maps to `--speed` (`standard` or `fast`).
- `isDefault` marks the default choice. Some models have no `effort` descriptor; omit `--thinking-effort` for those.
- If the chosen provider differs from the project's default instance and no model is given, the CLI fails with `MODEL_REQUIRED_FOR_PROVIDER`. In that case, always give both provider and model.
- No field tells you whether a listed model matches the account's plan or entitlement — a model can be visible, not hidden, and still fail at dispatch time for that reason.
- `providers list` (not `models list`) also returns `usageLimits` per provider instance: `checkedAt`, a `windows[]` array (`id`, `kind`, `label`, `usedPercent`, `resetsAt`), and `unavailable` when the account has no usage data or a probe failed. This is T3's own subscription-quota data, the same numbers behind its usage panel. It covers the whole provider instance, not one model. `usageLimits` is `null` when the driver has no notion of usage at all — an API-key account, for example.
