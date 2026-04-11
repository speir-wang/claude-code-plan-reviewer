#!/usr/bin/env node
// Bundles the browser TypeScript into a single JS file using esbuild.
// Also copies static assets (index.html, styles.css) into dist/browser.

import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'src', 'browser');
const outDir = path.join(projectRoot, 'dist', 'browser');

await mkdir(outDir, { recursive: true });

const entryPoint = path.join(srcDir, 'app.ts');

if (existsSync(entryPoint)) {
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outfile: path.join(outDir, 'app.js'),
    sourcemap: true,
    logLevel: 'info',
  });
}

// Copy static assets that exist
for (const asset of ['index.html', 'styles.css']) {
  const src = path.join(srcDir, asset);
  if (existsSync(src)) {
    await copyFile(src, path.join(outDir, asset));
  }
}

process.stderr.write('browser bundle complete\n');
