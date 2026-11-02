import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

test("dark workspace keeps primary text and metrics readable without heavy font weights", async () => {
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const roots = [...css.matchAll(/:root\s*\{([^}]*)\}/g)];
  const metrics = [...css.matchAll(/\.metric-value\s*\{([^}]*)\}/g)];
  const headings = [...css.matchAll(/\.panel-heading h2\s*\{([^}]*)\}/g)];
  const root = roots.at(-1)?.[1] ?? "";
  const metric = metrics.at(-1)?.[1] ?? "";
  const heading = headings.at(-1)?.[1] ?? "";
  assert.match(root, /color-scheme:\s*dark/i, "dark color scheme must be enabled");
  assert.match(root, /--text:\s*#f2f4f5/i, "primary text token must be light");
  assert.match(root, /--muted:\s*#92979e/i, "secondary text token must remain distinct");
  assert.match(metric, /color:\s*var\(--text\)/i, "headline metric values must use the primary text token");
  assert.match(heading, /color:\s*var\(--text\)/i, "panel headings must use the primary text token");
  assert.match(root, /font-weight:\s*400/i, "base font weight must remain regular");
  assert.doesNotMatch(css, /\.metric-value\s*\{[^}]*color:\s*#000000/i, "dark metrics must not fall back to black");
});
