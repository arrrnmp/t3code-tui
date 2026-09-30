/**
 * Diffs the browser render's per-cell text colours against opentui's
 * (`<Name>.<Export>.spans.json` from ref.tsx). Run from the repo root after
 * ref.tsx and a converter build:
 *   node .design-sync/pkg/ref/colors.mjs Code Diff
 * Prints, per export, glyph cells compared / colour mismatches, with samples.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = process.cwd();
const require = createRequire(join(ROOT, ".ds-sync/package.json"));
const { chromium } = require("playwright");
const REF = resolve(ROOT, ".design-sync/.cache/ref");
const BUNDLE = resolve(ROOT, "ds-bundle/components");

const htmlFor = (name) => {
  for (const g of readdirSync(BUNDLE)) {
    const p = join(BUNDLE, g, name, `${name}.html`);
    if (existsSync(p)) return p;
  }
  throw new Error(`no ${name}.html in ds-bundle`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
let bad = 0;
for (const name of process.argv.slice(2)) {
  const exports = readdirSync(REF).filter((f) => f.startsWith(`${name}.`) && f.endsWith(".spans.json")).map((f) => f.slice(name.length + 1, -".spans.json".length));
  for (const exp of exports) {
    const ref = JSON.parse(readFileSync(join(REF, `${name}.${exp}.spans.json`), "utf8"));
    await page.goto(`${pathToFileURL(htmlFor(name)).href}?story=${exp}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1200);
    const dom = await page.evaluate(() => {
      const term = document.querySelector(".mx-term");
      if (!term) return null;
      const origin = term.getBoundingClientRect();
      const cs = getComputedStyle(term);
      const probe = document.createElement("span");
      probe.textContent = "0".repeat(100);
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      term.appendChild(probe);
      const cw = probe.getBoundingClientRect().width / 100;
      probe.remove();
      const lh = parseFloat(cs.lineHeight);
      const cells = {};
      const walker = document.createTreeWalker(term, NodeFilter.SHOW_TEXT);
      const toHex = (c) => {
        const m = c.match(/\d+(\.\d+)?/g).map(Number);
        return "#" + m.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
      };
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest("[aria-hidden]")) continue;
        // Effective colour: the glyph's colour faded by every ancestor's
        // opacity over the nearest opaque background, plus any translucent
        // layer painted above it (a modal's dimmed backdrop) — what the eye sees.
        const rgb = (c) => c.match(/[\d.]+/g).map(Number);
        let [r, g, b] = rgb(getComputedStyle(el).color);
        let alpha = 1;
        for (let a = el; a && a !== term.parentElement; a = a.parentElement) alpha *= Number(getComputedStyle(a).opacity);
        let bgEl = el;
        let bg = [0, 0, 0];
        for (; bgEl; bgEl = bgEl.parentElement) {
          const c = rgb(getComputedStyle(bgEl).backgroundColor);
          if ((c[3] ?? 1) > 0) { bg = c; break; }
        }
        [r, g, b] = [r, g, b].map((v, i) => v * alpha + bg[i] * (1 - alpha));
        const color = (x, y) => {
          let [cr, cg, cb] = [r, g, b];
          for (const over of document.elementsFromPoint(x, y)) {
            if (over === el || over.contains(el)) break;
            const o = Number(getComputedStyle(over).opacity);
            const c = rgb(getComputedStyle(over).backgroundColor);
            const a = (c[3] ?? 1) * o;
            if (a > 0 && a < 1) [cr, cg, cb] = [cr, cg, cb].map((v, i) => v * (1 - a) + c[i] * a);
          }
          return "#" + [cr, cg, cb].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
        };
        const text = n.textContent;
        for (let i = 0; i < text.length; i++) {
          if (/\s/.test(text[i])) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + 1);
          const rect = r.getClientRects()[0];
          if (!rect || rect.width === 0) continue;
          const col = Math.round((rect.left - origin.left) / cw);
          const row = Math.floor((rect.top + rect.height / 2 - origin.top) / lh);
          cells[`${row}:${col}`] = [text[i], color(rect.left + rect.width / 2, rect.top + rect.height / 2)];
        }
      }
      return cells;
    });
    if (!dom) {
      console.log(`${name}.${exp}: no .mx-term in page`);
      continue;
    }
    let compared = 0;
    const misses = [];
    ref.forEach((line, row) =>
      line.forEach(([ch, fg], col) => {
        if (!ch.trim()) return;
        const got = dom[`${row}:${col}`];
        if (!got || got[0] !== ch) return; // layout diffs are the char-frame check's job
        compared++;
        const near = (a, b) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
        if (!near(got[1], fg)) misses.push(`r${row}c${col} '${ch}' ref ${fg} got ${got[1]}`);
      }),
    );
    bad += misses.length;
    console.log(`${name}.${exp}: ${compared} glyphs compared, ${misses.length} colour mismatches${misses.length ? `\n  ${misses.slice(0, 12).join("\n  ")}` : ""}`);
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
