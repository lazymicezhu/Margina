import { spawnSync } from 'node:child_process';
// Explicit public-build allowlist: never copy public/samples into this output.
for (const args of [['scripts/prepare-assets.mjs'], ['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, MARGINA_PUBLIC_BUILD: '1' } });
  if (result.status !== 0) process.exit(result.status || 1);
}
