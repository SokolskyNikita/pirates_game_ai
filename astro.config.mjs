// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ai-pirates-game.com',
  output: 'static',
  compressHTML: true,
  devToolbar: { enabled: false },
  integrations: [sitemap()],
});
