/**
 * Ponte com o app Android (mobile/, feito em NativeScript).
 *
 * No APK o jogo roda dentro de uma WebView que injeta `window.PokeNative`.
 * Aqui ficam as poucas coisas que um navegador faz sozinho e uma WebView nao:
 * baixar um arquivo, por exemplo, vira o seletor de arquivos do Android.
 */

interface NativeBridge {
  /** Abre o "Salvar como" do Android com o texto ja pronto. */
  saveFile(name: string, mime: string, content: string): void;
}

declare global {
  interface Window {
    PokeNative?: NativeBridge;
  }
}

/** True dentro do APK; false no navegador e no PWA instalado. */
export function isNativeApp(): boolean {
  return import.meta.env.VITE_NATIVE === '1' || typeof window.PokeNative !== 'undefined';
}

export function nativeBridge(): NativeBridge | null {
  return typeof window !== 'undefined' ? (window.PokeNative ?? null) : null;
}
