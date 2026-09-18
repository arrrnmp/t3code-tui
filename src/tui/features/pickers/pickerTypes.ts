/** Centered picker modal: model/effort lists, the diff-turn list, the
    command palette, the rename or custom-answer prompt, message actions, or
    the new-thread project list. */
export type PickerName =
  | "model"
  | "effort"
  | "permission"
  | "diff-turn"
  | "command"
  | "rename"
  | "message"
  | "answer-custom"
  | "project"
  | "project-new"
  | null;
