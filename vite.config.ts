import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
  // A versao do package.json chega ao jogo: e ela que decide quando mostrar as
  // novidades e o que aparece nas configuracoes.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'PokeDeluge',
        short_name: 'PokeDeluge',
        description: 'RPG de Pokemon para jogar no celular, com Kanto inteira para explorar.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0d1117',
        theme_color: '#0d1117',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Os mapas e tilesets de Kanto entram no precache: o jogo abre offline.
        globPatterns: ['**/*.{js,css,html,png,json,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        // Versoes antigas saem do cache sozinhas: ninguem precisa limpar nada
        // na mao para receber uma atualizacao.
        cleanupOutdatedCaches: true,
        // Sem isto, na primeira visita o service worker ativa mas nao controla
        // a pagina -- e uma versao nova passaria direto, sem ficar em espera,
        // deixando o jogador preso na antiga.
        clientsClaim: true,
        runtimeCaching: [
          {
            // Sprites de Pokemon vem do repositorio do PokeAPI sob demanda;
            // uma vez vistos, ficam disponiveis offline para sempre.
            urlPattern: /^https:\/\/raw\.githubusercontent\.com\/PokeAPI\/sprites\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pokemon-sprites',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
