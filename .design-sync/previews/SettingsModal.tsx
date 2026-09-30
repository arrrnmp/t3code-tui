import { Terminal, SettingsModal, describeSettings, DEFAULT_CONFIG } from "@moxen/tui";

const noop = () => {};

/** What the server sends for settings.read: every descriptor in core/configschema.ts with its default value, built from the real table. */
const SETTINGS = describeSettings(DEFAULT_CONFIG);

const snapshot = { path: "/home/dev/.config/moxen/config.json", exists: true, settings: SETTINGS };
const frame = { screenWidth: 100, screenHeight: 30, left: 4, top: 1, width: 92, height: 28, onSet: noop, onClose: noop };

/** The settings page: section tabs down the left, the General section's cards on the right. */
export function General() {
  return (
    <Terminal width={100} height={30}>
      <SettingsModal {...frame} snapshot={snapshot as never} loading={false} saving={null} error={null} providers={[]} />
    </Terminal>
  );
}

/** A write in flight on one card, and a refused value reported under the page. */
export function SavingWithError() {
  return (
    <Terminal width={100} height={30}>
      <SettingsModal
        {...frame}
        snapshot={{ ...snapshot, settings: SETTINGS.map((view) => (view.descriptor.key === "threadEnvMode" ? { ...view, value: "worktree" } : view)) } as never}
        loading={false}
        saving="threadEnvMode"
        error={"openMode: \"desktop\" needs the Moxen desktop app, which is not installed"}
        providers={[]}
      />
    </Terminal>
  );
}

/** Before the snapshot lands: the page says it is reading. */
export function Loading() {
  return (
    <Terminal width={100} height={12}>
      <SettingsModal {...frame} screenHeight={12} height={6} top={3} snapshot={null} loading saving={null} error={null} providers={null} />
    </Terminal>
  );
}

/** A config file not written yet: the path says so. */
export function NotCreated() {
  return (
    <Terminal width={100} height={30}>
      <SettingsModal {...frame} snapshot={{ ...snapshot, path: "/home/dev/.config/moxen/config.json", exists: false } as never} loading={false} saving={null} error={null} providers={[]} />
    </Terminal>
  );
}
