import { existsSync, statSync } from 'node:fs';
for (const file of ['index.html', 'mobile.html', 'admin.html', 'build-static.mjs', 'render.yaml']) {
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`Missing ${file}`);
}
console.log('CN Capital stage2 UI static checks passed');
