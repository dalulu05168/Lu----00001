import { cpSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const out = resolve(root, "dist");
const files = ["index.html", "mobile.html", "admin.html"];
for (const file of files) {
  const source = resolve(root, file);
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Missing preview asset: ${file}`);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of files) cpSync(resolve(root, file), resolve(out, file));
console.log(`UI preview built: ${files.join(", ")}`);
