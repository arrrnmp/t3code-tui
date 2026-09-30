---
category: Primitives
---
opentui's `<input>`: a one-row text field. No border or box of its own — it sits on its parent's surface; colour it with the focused/unfocused pairs. Emits the whole value: `onInput(value)` on every edit, `onSubmit(value)` on enter.

## Props

```ts
interface InputProps {
  value?: string;
  placeholder?: string;
  focused?: boolean;
  maxLength?: number;
  textColor?: string; backgroundColor?: string;
  focusedTextColor?: string; focusedBackgroundColor?: string;
  placeholderColor?: string;
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  style?: { width?: number | string; flexGrow?: number };
}
```

## Example

```jsx
<Input focused value={name} placeholder="Thread title" textColor={COLOR.text} focusedTextColor={COLOR.bright}
  backgroundColor={SURFACE.raised} focusedBackgroundColor={SURFACE.raised} placeholderColor={COLOR.faint}
  onInput={setName} onSubmit={save} />
```
