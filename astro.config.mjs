// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ai-pirates-game.com',
  output: 'static',
  compressHTML: true,
  devToolbar: { enabled: false },
  integrations: [sitemap()],
  vite: { server: { strictPort: true, proxy: { '/api': { target: `http://localhost:${process.env.PIRATES_API_PORT || 8787}`, changeOrigin: false } } } },
});
