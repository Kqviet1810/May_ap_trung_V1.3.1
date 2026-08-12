import { cp, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const distDir = path.join(projectRoot, 'dist');
const fixedDeploymentPaths = [
  'assets',
  'icons',
  'config.json',
  'icon.svg',
  'index.html',
  'manifest.webmanifest',
  'sw.js'
];

for (const relativePath of fixedDeploymentPaths) {
  await rm(path.join(projectRoot, relativePath), { recursive: true, force: true });
}

for (const entry of await readdir(projectRoot)) {
  if (/^workbox-.*\.js$/.test(entry)) {
    await rm(path.join(projectRoot, entry), { force: true });
  }
}

for (const entry of await readdir(distDir)) {
  await cp(path.join(distDir, entry), path.join(projectRoot, entry), { recursive: true });
}

await writeFile(path.join(projectRoot, '.nojekyll'), '');
console.log('Đã đồng bộ dist/ vào thư mục gốc cho GitHub Pages.');
