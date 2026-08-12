import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icon.svg'],
      manifest: {
        name: 'MAYAP Control',
        short_name: 'MAYAP',
        description: 'Theo dõi, cấu hình và điều khiển máy ấp trứng MAYAP.',
        theme_color: '#123f38',
        background_color: '#f4f7f5',
        display: 'standalone',
        orientation: 'any',
        scope: './',
        start_url: './',
        lang: 'vi',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        mode: 'development',
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/config.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mayap-runtime-config',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 1, maxAgeSeconds: 300 }
            }
          }
        ]
      }
    })
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: true
  }
});
