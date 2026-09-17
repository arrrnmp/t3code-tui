import type { BaseRenderable } from "@opentui/core";

/**
 * `Renderable.selectable` (defaults to `true`) is read by every renderable's
 * constructor at runtime (`this.selectable = options.selectable ?? true`,
 * confirmed in `@opentui/core`'s compiled output) but missing from this
 * package's shipped `RenderableOptions` type, so `<box selectable={false}>`
 * fails to typecheck even though the prop works. This restores it.
 */
declare module "@opentui/core" {
  interface RenderableOptions<T extends BaseRenderable = BaseRenderable> {
    selectable?: boolean;
  }
}
