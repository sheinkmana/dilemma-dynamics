import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  base: mode === 'public' ? '/dilemma-dynamics/' : '/',
  plugins: [
    react(),
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
