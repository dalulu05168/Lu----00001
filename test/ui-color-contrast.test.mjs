import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("light dashboard uses pure black for primary text without changing font weights", async () => {
  const css = await readFile(new URL("../web/styles.css", import.meta.url), "utf8");
  const root = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const metric = css.match(/\.metric-value\s*\{([^}]*)\}/)?.[1] ?? "";
  const heading = css.match(/\.panel-heading h2\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(root, /(?:^|;)\s*color:\s*#000000\s*(?:;|$)/i, "base text color must be pure black");
  assert.match(root, /--text:\s*#000000\s*(?:;|$)/i, "primary text token must be pure black");
  assert.match(metric, /color:\s*#000000\s*(?:;|$)/i, "headline metric values must be pure black");
  assert.match(heading, /color:\s*#000000\s*(?:;|$)/i, "panel headings must be pure black");
  assert.match(root, /font-weight:\s*400/i, "base font weight must remain regular");
  assert.match(metric, /font-weight:\s*400/i, "metric font weight must remain unchanged");
});
