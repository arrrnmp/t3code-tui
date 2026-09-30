/**
 * The reference side of the fidelity check: the same public surface as
 * `../src/index.ts`, but with the primitives and `Terminal` backed by the
 * real opentui renderer instead of the DOM shim. `ref.tsx` renders every
 * authored preview through this and prints opentui's own char frame.
 */
import type { ReactNode } from "react";
export * from "../src/index.ts";

export function Terminal({ children }: { width?: number; height?: number; children?: ReactNode }) {
  return <box style={{ flexDirection: "column", flexGrow: 1 }}>{children}</box>;
}
export const Box = (p: any) => <box {...p} />;
export const Text = (p: any) => <text {...p} />;
export const ScrollBox = (p: any) => <scrollbox {...p} />;
export const Markdown = (p: any) => <markdown {...p} />;
export const Code = (p: any) => <code {...p} />;
export const Diff = (p: any) => <diff {...p} />;
export const Input = (p: any) => <input {...p} />;
export const Textarea = (p: any) => <textarea {...p} />;
