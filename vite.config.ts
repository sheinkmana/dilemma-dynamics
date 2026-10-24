import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// A TeX preview may leave temporary files beside the public report while Vite
// copies public/. Ship only the reviewed manifest, never compiler intermediates.
function curateResearchExport() {
  const directory = resolve('dist/web/research');
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
    files: Record<string, string>;
  };
  const allowed = new Set(['manifest.json', ...Object.keys(manifest.files)]);
  const visit = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!allowed.has(relative(directory, path).split('\\').join('/'))) unlinkSync(path);
    }
  };
  visit(directory);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const actual = createHash('sha256')
      .update(readFileSync(join(directory, name)))
      .digest('hex');
    if (actual !== expected) throw new Error(`Public research checksum mismatch: ${name}`);
  }
  copyFileSync('FINAL_EVALUATION.md', 'dist/web/FINAL_EVALUATION.md');
}

export default defineConfig(({ mode }) => ({
  base: mode === 'public' ? '/dilemma-dynamics/' : '/',
  plugins: [
    react(),
    { name: 'curated-research-export', apply: 'build', closeBundle: curateResearchExport },
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
