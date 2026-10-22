import { mkdtempSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  // Vite rejects colons in served paths, including valid macOS folder names.
  // Keep its filesystem restrictions enabled by serving through a safe alias.
  if (command !== 'serve' || !projectRoot.includes(':')) return {};
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'margina-vite-'));
  const root = join(temporaryDirectory, 'project');
  symlinkSync(projectRoot, root, 'dir');
  process.once('exit', () => {
    unlinkSync(root);
    rmdirSync(temporaryDirectory);
  });
  return { root, resolve: { preserveSymlinks: true } };
});
