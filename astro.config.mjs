import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://driftregistry.example',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    build: {
      // The generated ocean data is large and highly compressible; keep it in
      // its own chunks rather than inlining copies into every page.
      assetsInlineLimit: 2048,
    },
  },
});
