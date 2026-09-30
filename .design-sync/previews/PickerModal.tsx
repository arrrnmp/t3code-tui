import { Terminal, Box, PickerModal, COLOR } from "@moxen/tui";

const noop = () => {};
const frame = { screenWidth: 80, screenHeight: 22, left: 14, top: 3, width: 52, height: 16, onClose: noop, onFilterChange: noop };

/** The model picker: sections, meta column, the current row marked. */
export function SelectModel() {
  return (
    <Terminal width={80} height={22}>
      <PickerModal
        {...frame}
        title="Select model"
        filter=""
        filterable
        emptyLabel="No models match"
        body={{
          kind: "list",
          sections: [
            {
              header: "Claude",
              headerColor: "#DE7356",
              rows: [
                { key: "opus", label: "Claude Opus 5", meta: "most capable", selected: true, onPick: noop },
                { key: "sonnet", label: "Claude Sonnet 5", meta: "fast, strong coding", onPick: noop },
                { key: "haiku", label: "Claude Haiku 4.5", meta: "fastest", onPick: noop },
              ],
            },
            {
              header: "Codex",
              headerColor: "#74AA9C",
              rows: [
                { key: "gpt", label: "gpt-5.5", meta: "reasoning", onPick: noop },
                { key: "mini", label: "gpt-5.5-mini", meta: "not yet supported", disabled: true, onPick: noop },
              ],
            },
          ],
        }}
      />
    </Terminal>
  );
}

/** Filtering with no matches. */
export function Empty() {
  return (
    <Terminal width={80} height={22}>
      <PickerModal {...frame} height={9} title="Switch thread" filter="kubernetes" filterable emptyLabel="No threads match" body={{ kind: "list", sections: [] }} />
    </Terminal>
  );
}

/** Loading and error bodies. */
export function Loading() {
  return (
    <Terminal width={80} height={22}>
      <PickerModal {...frame} height={7} title="Select model" filter="" filterable={false} emptyLabel="" body={{ kind: "loading" }} />
    </Terminal>
  );
}
