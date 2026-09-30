---
category: Primitives
---
opentui's `<textarea>`: a multi-row editor that grows between `style.minHeight` and `style.maxHeight` rows. Enter submits; shift/ctrl/meta+enter insert a newline. Read and set its text through the ref (`plainText`, `setText`, `insertText`, `cursorOffset`). The Composer is built on this — prefer `Composer` for a chat input.

## Props

```ts
interface TextareaProps {
  initialValue?: string;
  placeholder?: string;
  focused?: boolean;
  textColor?: string; backgroundColor?: string;
  focusedTextColor?: string; focusedBackgroundColor?: string;
  placeholderColor?: string;
  wrapMode?: "word" | "char" | "none";
  style?: { minHeight?: number; maxHeight?: number; flexGrow?: number; backgroundColor?: string };
  onContentChange?: () => void;
  onSubmit?: () => void;
  onKeyDown?: (key: { name: string; ctrl: boolean; shift: boolean; meta: boolean; preventDefault(): void }) => void;
  ref?: React.Ref<unknown>;
}
```

## Example

```jsx
<Textarea focused placeholder="Ask anything…" textColor={COLOR.text} focusedTextColor={COLOR.bright}
  backgroundColor={SURFACE.raised} placeholderColor={COLOR.faint} style={{ minHeight: 3, maxHeight: 10 }} />
```
