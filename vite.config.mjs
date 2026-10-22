import { mkdtempSync, symlinkSync, unlinkSync, rmdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const projectRoot = fileURLToPath(new URL('.', import.meta.url));
  const cloudBuild = process.env.MARGINA_PUBLIC_BUILD === '1';
  const base = cloudBuild ? {
    publicDir: false,
    build: { outDir: 'dist-cloud' },
    plugins: [{ name: 'public-reader-assets', closeBundle() {
      cpSync(join(projectRoot, 'public/pdf-assets'), join(projectRoot, 'dist-cloud/pdf-assets'), { recursive: true });
      cpSync(join(projectRoot, 'public/favicon.svg'), join(projectRoot, 'dist-cloud/favicon.svg'));
    } }],
  } : {};
  // Vite rejects colons in served paths, including valid macOS folder names.
  // Keep its filesystem restrictions enabled by serving through a safe alias.
  if (command !== 'serve' || !projectRoot.includes(':')) return base;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'margina-vite-'));
  const root = join(temporaryDirectory, 'project');
  symlinkSync(projectRoot, root, 'dir');
  process.once('exit', () => {
    unlinkSync(root);
    rmdirSync(temporaryDirectory);
  });
  return { ...base, root, resolve: { preserveSymlinks: true } };
});
