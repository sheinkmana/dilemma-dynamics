import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// The website is an explicit publication surface, not a copy of the scientific
// repository export. Raw tables and source remain available through the README.
function exportWebsiteAssets() {
  const directory = resolve('dist/web');
  const manifest = JSON.parse(readFileSync('public/research/manifest.json', 'utf8')) as {
    files: Record<string, string>;
  };
  const scientificAssets = [
    'paper/report.pdf',
    'figures/primary-results.png',
    'figures/condition-effects.png',
    'figures/autonomous-self-play.png',
    'temperature-zero/episodes.json',
    'temperature-one/episodes.json',
  ];
  for (const name of scientificAssets) {
    const source = join('public/research', name);
    const actual = createHash('sha256').update(readFileSync(source)).digest('hex');
    if (actual !== manifest.files[name])
      throw new Error(`Scientific export checksum mismatch: ${name}`);
  }
  const assets = [
    ['LICENSE', 'LICENSE.txt'],
    ...scientificAssets.map((name) => [`public/research/${name}`, `research/${name}`]),
    ['src/web/viewer-study.json', 'research/viewer-study.json'],
    ['public/brands/nebius.svg', 'brands/nebius.svg'],
    ['public/brands/nvidia.svg', 'brands/nvidia.svg'],
    ['public/brands/nebius-nvidia-hackathon.png', 'brands/nebius-nvidia-hackathon.png'],
  ];
  for (const [source, name] of assets) {
    const destination = join(directory, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  const files: Record<string, string> = {};
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        const name = relative(directory, path).split('\\').join('/');
        files[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
      }
    }
  };
  visit(directory);
  writeFileSync(
    join(directory, 'website-manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        scope:
          'App, PDF notes, scientific viewer data and saved actions. Full research export and TeX source are available in the repository.',
        files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
      },
      null,
      2,
    ) + '\n',
  );
}

export default defineConfig(({ mode, command }) => ({
  base: mode === 'public' ? '/dilemma-dynamics/' : '/',
  publicDir: command === 'build' ? false : 'public',
  plugins: [
    react(),
    {
      name: 'explicit-website-export',
      apply: 'build',
      buildStart() {
        execFileSync(process.execPath, ['tools/build-viewer-data.mjs', '--check']);
      },
      closeBundle: exportWebsiteAssets,
    },
    ...(mode === 'public'
      ? [
          {
            name: 'public-demo-entry',
            transformIndexHtml: {
              order: 'pre' as const,
              handler: (html: string) => html.replace('/src/web/main.tsx', '/src/web/public.tsx'),
            },
          },
        ]
      : []),
  ],
  build: { outDir: 'dist/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request) => request.setHeader('Origin', 'http://127.0.0.1:4317'));
        },
      },
    },
  },
}));
