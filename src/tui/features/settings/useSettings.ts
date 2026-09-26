import { useCallback, useEffect, useRef, useState } from "react";

import type { ClientApi, SettingsSnapshot } from "../../../server/api.js";
import type { UiConfig } from "../../../core/types.js";

/**
 * The settings page's state: one read on open, one write per edit, and
 * the server's answer is what gets rendered.
 *
 * Deliberately not optimistic. A setting can be rejected (a bad duration,
 * an out-of-range number) or normalized on the way in, so showing the
 * value we *sent* would be a lie half the time. Instead the row shows a
 * pending mark until the server answers with the whole snapshot, which is
 * also how a change another client made shows up.
 */
export interface SettingsState {
  readonly snapshot: SettingsSnapshot | null;
  readonly loading: boolean;
  /** The key currently being written, for a pending mark on that row. */
  readonly saving: string | null;
  readonly error: string | null;
  readonly set: (key: string, value: string) => void;
  readonly reload: () => void;
}

export function useSettings(client: ClientApi, open: boolean): SettingsState {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards a response arriving after the page closed (or after a newer
  // request overtook it) from overwriting what is on screen.
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = (generation.current += 1);
    setLoading(true);
    void client
      .query({ type: "settings.read" })
      .then((next) => {
        if (generation.current !== mine) return;
        setSnapshot(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (generation.current !== mine) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (generation.current === mine) setLoading(false);
      });
  }, [client]);

  useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  const set = useCallback(
    (key: string, value: string) => {
      const mine = (generation.current += 1);
      setSaving(key);
      void client
        .dispatch({ type: "settings.set", key, value })
        .then((result) => {
          if (generation.current !== mine) return;
          setSnapshot({ path: result.path, exists: result.exists, settings: result.settings });
          setError(null);
        })
        .catch((cause: unknown) => {
          if (generation.current !== mine) return;
          // The value stays as it was: the server refused it, so the row
          // keeps showing what is actually in force.
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (generation.current === mine) setSaving(null);
        });
    },
    [client],
  );

  return { snapshot, loading, saving, error, set, reload: load };
}

/**
 * The `ui.*` values from a snapshot, as the shape the app draws with. The
 * app starts from the config it launched with and switches to this once a
 * snapshot exists, so an edit on the settings page redraws immediately
 * rather than after a restart.
 */
export function uiFromSnapshot(snapshot: SettingsSnapshot | null): UiConfig | null {
  if (snapshot === null) return null;
  const value = (key: string): unknown => snapshot.settings.find((view) => view.descriptor.key === key)?.value;
  const backdrop = value("ui.backdrop");
  const side = value("ui.defaultSidePanel");
  const context = value("ui.contextRefreshSeconds");
  const usage = value("ui.usageRefreshSeconds");
  return {
    ...(backdrop === "animated" || backdrop === "static" || backdrop === "off" ? { backdrop } : {}),
    ...(side === "context" || side === "git" || side === "agents" || side === "background" ? { defaultSidePanel: side } : {}),
    ...(typeof context === "number" ? { contextRefreshSeconds: context } : {}),
    ...(typeof usage === "number" ? { usageRefreshSeconds: usage } : {}),
  };
}
