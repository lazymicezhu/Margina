import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const config = 'wrangler.local.jsonc';
const cli = 'node_modules/wrangler/bin/wrangler.js';
mkdirSync('.wrangler/logs', { recursive: true });
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/logs/local.log') };
if (!existsSync('dist-cloud/index.html')) {
  const result = spawnSync(process.execPath, ['scripts/cloud-build.mjs'], { stdio: 'inherit', env });
  if (result.status !== 0) process.exit(result.status || 1);
}
const migration = spawnSync(process.execPath, [cli, 'd1', 'execute', 'margina-local', '--local', '--config', config, '--file', 'server/schema.sql'], { stdio: 'inherit', env });
if (migration.status !== 0) process.exit(migration.status || 1);
const server = spawn(process.execPath, [cli, 'dev', '--local', '--config', config, '--ip', '127.0.0.1', '--port', process.env.MARGINA_LOCAL_PORT || '8787'], { stdio: 'inherit', env });
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
server.on('exit', code => process.exit(code || 0));
