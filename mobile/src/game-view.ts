import { View } from '@nativescript/core';

/** A classe Java do projeto (App_Resources/Android/src/main/java). */
declare const com: {
  davipac: {
    pokedeluge: {
      GameWebView: new (context: android.content.Context) => GameWebViewNative;
    };
  };
};

interface GameWebViewNative extends android.webkit.WebView {
  start(): void;
  pauseGame(): void;
  resumeGame(): void;
  handleActivityResult(requestCode: number, resultCode: number, data: android.content.Intent): boolean;
}

/** A WebView do jogo como uma View do NativeScript, ocupando a tela toda. */
export class GameView extends View {
  declare nativeViewProtected: GameWebViewNative;
  private paused = false;

  createNativeView(): Object {
    return new com.davipac.pokedeluge.GameWebView(this._context);
  }

  initNativeView(): void {
    super.initNativeView();
    this.nativeViewProtected.start();
  }

  disposeNativeView(): void {
    this.nativeViewProtected.destroy();
    super.disposeNativeView();
  }

  pause(): void {
    if (this.paused || !this.nativeViewProtected) return;
    this.paused = true;
    this.nativeViewProtected.pauseGame();
  }

  resume(): void {
    if (!this.paused || !this.nativeViewProtected) return;
    this.paused = false;
    this.nativeViewProtected.resumeGame();
  }

  handleActivityResult(requestCode: number, resultCode: number, data: android.content.Intent): void {
    this.nativeViewProtected?.handleActivityResult(requestCode, resultCode, data);
  }
}
