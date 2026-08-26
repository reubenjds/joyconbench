import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const applicationVersion = process.env.npm_package_version ?? '0.1.0';
const commit = (process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA)?.slice(0, 7) ?? 'local';
const productionBranch = !process.env.CF_PAGES || process.env.CF_PAGES_BRANCH === 'main';
const basePath = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'JoyConBench',
        short_name: 'JoyConBench',
        description: 'Open controller diagnostics for Nintendo Switch.',
        theme_color: '#0000ff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: basePath,
        icons: [
          { src: `${basePath}icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,json}'],
        navigateFallback: `${basePath}index.html`,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(`${applicationVersion}+${commit}`),
    __ENABLE_PWA__: JSON.stringify(productionBranch),
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    coverage: { reporter: ['text', 'html'] },
  },
});
