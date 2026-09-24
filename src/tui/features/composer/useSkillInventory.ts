import { useEffect, useState } from "react";

import type { SkillInventory } from "../../../core/catalog/summary.js";
import type { ClientApi } from "../../../server/api.js";

/**
 * The composer's skill picker source: the skills the open thread's provider
 * resolves in that thread's directory (`skills.list`), fetched once per
 * provider + directory for the life of the app — a provider takes about a
 * second to answer, so switching threads back and forth must not re-ask.
 *
 * Undefined until the first answer arrives, and when there is nothing to
 * ask about (no provider or no directory yet); a failed lookup reads as an
 * empty inventory rather than an error, since the picker is a convenience.
 */
const cache = new Map<string, Promise<SkillInventory | null>>();

export function useSkillInventory(
  client: ClientApi,
  instanceId: string | null | undefined,
  cwd: string | null | undefined,
): SkillInventory | undefined {
  const [inventory, setInventory] = useState<SkillInventory | undefined>(undefined);
  useEffect(() => {
    setInventory(undefined);
    if (!instanceId || !cwd) return;
    const key = `${instanceId}\u0000${cwd}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = client.query({ type: "skills.list", instanceId, cwd }).catch(() => null);
      cache.set(key, pending);
    }
    let live = true;
    void pending.then((result) => {
      if (live) setInventory(result ?? { trigger: "/", skills: [], commands: [] });
    });
    return () => {
      live = false;
    };
  }, [client, instanceId, cwd]);
  return inventory;
}
