/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injetadas pelo Vite a partir do package.json (ver vite.config.ts). */
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /** '1' no build que vai dentro do APK (npm run build:native). */
  readonly VITE_NATIVE?: string;
}
